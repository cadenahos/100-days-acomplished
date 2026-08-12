using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using MongoDB.Bson;
using MongoDB.Driver;

var builder = WebApplication.CreateBuilder(args);

// ---------------------------------------------------------------------------
// Logging: write structured, timestamped logs to stdout so Cloud Run picks
// them up. Raise ASP.NET Core to Information so request/auth failures show.
// ---------------------------------------------------------------------------
builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(o =>
{
    o.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ ";
    o.UseUtcTimestamp = true;
    o.SingleLine = true;
});

// ---------------------------------------------------------------------------
// Cloud Run injects PORT. Bind to it explicitly instead of relying on defaults.
// ---------------------------------------------------------------------------
var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

builder.Services.Configure<Backend.Models.ChallengeDatabaseSettings>(
    builder.Configuration.GetSection("ChallengeStoreDatabase"));

var mongoConnectionString =
    builder.Configuration.GetValue<string>("ChallengeStoreDatabase:ConnectionString")
    ?? "mongodb://localhost:27017";

builder.Services.AddSingleton<IMongoClient>(_ =>
{
    var settings = MongoClientSettings.FromConnectionString(mongoConnectionString);
    // Fail fast instead of hanging for 30s when Atlas is unreachable
    // (wrong URI, IP not allowlisted, egress blocked).
    settings.ServerSelectionTimeout = TimeSpan.FromSeconds(10);
    settings.ConnectTimeout = TimeSpan.FromSeconds(10);
    return new MongoClient(settings);
});

builder.Services.AddControllers();

// Cloud Run terminates TLS at the load balancer and forwards plain HTTP.
// Without this, Request.Scheme is "http" and generated URLs / redirects break.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownNetworks.Clear();
    options.KnownProxies.Clear();
});

var googleClientId = builder.Configuration["Google:ClientId"];

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = "https://accounts.google.com";
        options.TokenValidationParameters = new Microsoft.IdentityModel.Tokens.TokenValidationParameters
        {
            ValidateIssuer = true,
            // Google ID tokens use either of these two issuer values.
            ValidIssuers = new[] { "https://accounts.google.com", "accounts.google.com" },
            ValidateAudience = true,
            ValidAudience = googleClientId,
            ValidateLifetime = true
        };

        // Surface *why* a 401 happened. Without this, auth failures are silent
        // and indistinguishable from a broken backend.
        options.Events = new JwtBearerEvents
        {
            OnAuthenticationFailed = ctx =>
            {
                var log = ctx.HttpContext.RequestServices
                    .GetRequiredService<ILoggerFactory>().CreateLogger("Auth");
                log.LogWarning(ctx.Exception,
                    "JWT authentication FAILED for {Path}: {Message}",
                    ctx.Request.Path, ctx.Exception.Message);
                return Task.CompletedTask;
            },
            OnChallenge = ctx =>
            {
                var log = ctx.HttpContext.RequestServices
                    .GetRequiredService<ILoggerFactory>().CreateLogger("Auth");
                log.LogWarning(
                    "JWT challenge for {Path}. Error={Error} Description={Description} HasAuthHeader={HasHeader}",
                    ctx.Request.Path, ctx.Error, ctx.ErrorDescription,
                    ctx.Request.Headers.ContainsKey("Authorization"));
                return Task.CompletedTask;
            },
            OnTokenValidated = ctx =>
            {
                var log = ctx.HttpContext.RequestServices
                    .GetRequiredService<ILoggerFactory>().CreateLogger("Auth");
                log.LogInformation("JWT validated for {Subject}",
                    ctx.Principal?.FindFirst("email")?.Value ?? "(no email claim)");
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
});

builder.Services.AddOpenApi();

var app = builder.Build();

var startupLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");

// Log the effective configuration at boot. Secrets are redacted but presence
// is reported, which is what you actually need when debugging a deploy.
startupLogger.LogInformation(
    "Starting. Env={Env} Port={Port} MongoConfigured={MongoConfigured} MongoHost={MongoHost} GoogleClientIdSet={GoogleSet}",
    app.Environment.EnvironmentName,
    port,
    mongoConnectionString != "mongodb://localhost:27017",
    SafeMongoHost(mongoConnectionString),
    !string.IsNullOrWhiteSpace(googleClientId));

app.UseForwardedHeaders();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// NOTE: UseHttpsRedirection() is intentionally absent. Cloud Run already
// terminates TLS; enabling it here causes redirect loops or dropped requests
// because the container only ever receives plain HTTP.

// Request/response logging for every call, including unhandled exceptions.
app.Use(async (context, next) =>
{
    var log = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Request");
    var started = DateTime.UtcNow;
    try
    {
        await next();
    }
    catch (Exception ex)
    {
        log.LogError(ex, "UNHANDLED {Method} {Path}", context.Request.Method, context.Request.Path);
        throw;
    }
    finally
    {
        log.LogInformation("{Method} {Path} -> {Status} in {Elapsed}ms (origin={Origin})",
            context.Request.Method,
            context.Request.Path,
            context.Response.StatusCode,
            (int)(DateTime.UtcNow - started).TotalMilliseconds,
            context.Request.Headers.Origin.ToString());
    }
});

app.UseCors("AllowAll");

app.UseAuthentication();
app.UseAuthorization();

// ---------------------------------------------------------------------------
// Diagnostics endpoints. All anonymous so you can probe the service without
// a Google token and tell "backend down" apart from "auth broken".
// ---------------------------------------------------------------------------

// Liveness: proves the container started and is serving HTTP.
app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    service = "hundred-days-backend",
    utc = DateTime.UtcNow
})).AllowAnonymous();

// Readiness: proves the backend can actually reach MongoDB Atlas.
// This is the single most useful check — the app boots fine with a bad
// connection string and only fails on the first real request.
app.MapGet("/health/db", async (IMongoClient client, ILoggerFactory lf) =>
{
    var log = lf.CreateLogger("HealthDb");
    try
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        await client.GetDatabase("admin")
            .RunCommandAsync<BsonDocument>(new BsonDocument("ping", 1));
        sw.Stop();
        log.LogInformation("Mongo ping OK in {Ms}ms", sw.ElapsedMilliseconds);
        return Results.Ok(new { status = "ok", database = "reachable", latencyMs = sw.ElapsedMilliseconds });
    }
    catch (Exception ex)
    {
        log.LogError(ex, "Mongo ping FAILED");
        return Results.Json(new
        {
            status = "error",
            database = "unreachable",
            error = ex.Message,
            hint = "Check MONGODB_ATLAS_URI and that Atlas Network Access allows 0.0.0.0/0 (or your Cloud Run egress IP)."
        }, statusCode: 503);
    }
}).AllowAnonymous();

// Config echo: confirms which env vars actually landed in the container.
// Values are redacted; only presence and shape are reported.
app.MapGet("/health/config", (IConfiguration cfg) =>
{
    var conn = cfg.GetValue<string>("ChallengeStoreDatabase:ConnectionString");
    var clientId = cfg["Google:ClientId"];
    return Results.Ok(new
    {
        mongoConnectionStringSet = !string.IsNullOrWhiteSpace(conn),
        mongoIsLocalhostFallback = string.IsNullOrWhiteSpace(conn) || conn.Contains("localhost"),
        mongoHost = SafeMongoHost(conn),
        databaseName = cfg["ChallengeStoreDatabase:DatabaseName"],
        collectionName = cfg["ChallengeStoreDatabase:ChallengesCollectionName"],
        googleClientIdSet = !string.IsNullOrWhiteSpace(clientId),
        googleClientIdSuffix = string.IsNullOrWhiteSpace(clientId)
            ? null
            : clientId[Math.Max(0, clientId.Length - 24)..],
        port = Environment.GetEnvironmentVariable("PORT")
    });
}).AllowAnonymous();

// Auth echo: hit this with your Google token to see exactly which claims the
// backend received. Returns 401 with a reason if the token is rejected.
app.MapGet("/health/auth", (HttpContext ctx) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
    {
        return Results.Json(new
        {
            authenticated = false,
            hasAuthorizationHeader = ctx.Request.Headers.ContainsKey("Authorization"),
            hint = "Send 'Authorization: Bearer <google_id_token>'. The token audience must equal Google:ClientId."
        }, statusCode: 401);
    }

    return Results.Ok(new
    {
        authenticated = true,
        email = ctx.User.FindFirst("email")?.Value,
        claims = ctx.User.Claims.Select(c => new { c.Type, c.Value })
    });
}).AllowAnonymous();

app.MapControllers();

startupLogger.LogInformation("Listening on http://0.0.0.0:{Port}", port);

app.Run();

// Strips credentials out of a Mongo URI so the host can be logged safely.
static string SafeMongoHost(string? connectionString)
{
    if (string.IsNullOrWhiteSpace(connectionString)) return "(unset)";
    try
    {
        var withoutScheme = connectionString.Split("://").Last();
        var hostPart = withoutScheme.Contains('@')
            ? withoutScheme.Split('@').Last()
            : withoutScheme;
        return hostPart.Split('/')[0].Split('?')[0];
    }
    catch
    {
        return "(unparseable)";
    }
}
