using System.Security.Claims;
using Backend.Domain;
using Backend.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using MongoDB.Driver;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class ChallengesController : ControllerBase
    {
        private readonly IMongoCollection<Challenge> _challengesCollection;
        private readonly ILogger<ChallengesController> _logger;

        public ChallengesController(
            IMongoClient mongoClient,
            IOptions<ChallengeDatabaseSettings> settings,
            ILogger<ChallengesController> logger)
        {
            var mongoDatabase = mongoClient.GetDatabase(settings.Value.DatabaseName);
            _challengesCollection = mongoDatabase.GetCollection<Challenge>(settings.Value.ChallengesCollectionName);
            _logger = logger;
        }

        private string GetUserEmail()
        {
            var emailClaim = User.FindFirst(ClaimTypes.Email) ?? User.FindFirst("email");
            return emailClaim?.Value ?? string.Empty;
        }

        [HttpPost]
        public async Task<ActionResult<Challenge>> CreateChallenge([FromBody] ChallengeDto dto)
        {
            var email = GetUserEmail();
            if (string.IsNullOrEmpty(email)) return Unauthorized("User email not found in token.");

            if (string.IsNullOrWhiteSpace(dto.Name))
                return BadRequest(new { message = "Give the challenge a name." });

            // Default to today when omitted. Past dates are rejected — otherwise
            // anyone could backdate a challenge to unlock days they never did.
            var today = DateTime.UtcNow.Date;
            var start = dto.StartDate?.Date ?? today;

            if (start < today)
            {
                return BadRequest(new
                {
                    message = $"The start date can't be in the past. Choose {today:yyyy-MM-dd} or later.",
                    earliestAllowed = today
                });
            }

            var challenge = new Challenge
            {
                UserEmail = email,
                Name = dto.Name.Trim(),
                CheckboxesState = new string('0', 100),
                StartDateUtc = start
            };

            await _challengesCollection.InsertOneAsync(challenge);

            _logger.LogInformation("Challenge '{Name}' created by {Email}, starting {Start:yyyy-MM-dd}",
                challenge.Name, email, start);

            return CreatedAtAction(nameof(GetChallenge), new { id = challenge.Id },
                new { challenge, state = StreakRules.Describe(challenge, DateTime.UtcNow) });
        }

        [HttpGet("{id}")]
        public async Task<IActionResult> GetChallenge(string id)
        {
            var email = GetUserEmail();
            var challenge = await _challengesCollection
                .Find(x => x.Id == id && x.UserEmail == email).FirstOrDefaultAsync();

            if (challenge == null) return NotFound();

            // Ship the rule evaluation with the data so the UI never has to
            // re-implement (and drift from) the server's logic.
            return Ok(new { challenge, state = StreakRules.Describe(challenge, DateTime.UtcNow) });
        }

        [HttpGet("my")]
        public async Task<ActionResult<List<Challenge>>> GetMyChallenges()
        {
            var email = GetUserEmail();
            var challenges = await _challengesCollection.Find(x => x.UserEmail == email).ToListAsync();
            return challenges;
        }

        /// <summary>
        /// Checks the next day in sequence. The client does not choose which box —
        /// the server does, so the rules cannot be bypassed by posting a crafted
        /// state string (which is what the old PUT endpoint allowed).
        /// </summary>
        [HttpPost("{id}/check")]
        public async Task<IActionResult> CheckNextDay(string id)
        {
            var email = GetUserEmail();
            var challenge = await _challengesCollection
                .Find(x => x.Id == id && x.UserEmail == email).FirstOrDefaultAsync();

            if (challenge == null) return NotFound();

            var now = DateTime.UtcNow;
            var decision = StreakRules.CanCheck(challenge, now);
            if (!decision.Allowed)
            {
                _logger.LogInformation("Check denied for {Email} on {Id}: {Reason}",
                    email, id, decision.Reason);
                return Conflict(new
                {
                    reason = decision.Reason.ToString(),
                    message = decision.Message,
                    state = StreakRules.Describe(challenge, now)
                });
            }

            StreakRules.ApplyCheck(challenge, now);
            await _challengesCollection.ReplaceOneAsync(
                x => x.Id == id && x.UserEmail == email, challenge);

            _logger.LogInformation("Day {Day} checked for {Email} on {Id}",
                StreakRules.CheckedCount(challenge.CheckboxesState), email, id);

            return Ok(new { challenge, state = StreakRules.Describe(challenge, now) });
        }

        /// <summary>
        /// Deletes a challenge. The filter matches on UserEmail as well as Id, so a
        /// guessed or leaked id belonging to someone else deletes nothing and 404s.
        /// </summary>
        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteChallenge(string id)
        {
            var email = GetUserEmail();
            if (string.IsNullOrEmpty(email)) return Unauthorized("User email not found in token.");

            var result = await _challengesCollection
                .DeleteOneAsync(x => x.Id == id && x.UserEmail == email);

            if (result.DeletedCount == 0)
            {
                _logger.LogInformation("Delete of {Id} by {Email} matched nothing", id, email);
                return NotFound();
            }

            _logger.LogInformation("Challenge {Id} deleted by {Email}", id, email);
            return NoContent();
        }

        /// <summary>Undoes the most recent check. Earlier days are immutable.</summary>
        [HttpPost("{id}/uncheck")]
        public async Task<IActionResult> UncheckLastDay(string id, [FromBody] UncheckDto dto)
        {
            var email = GetUserEmail();
            var challenge = await _challengesCollection
                .Find(x => x.Id == id && x.UserEmail == email).FirstOrDefaultAsync();

            if (challenge == null) return NotFound();

            var now = DateTime.UtcNow;
            var decision = StreakRules.CanUncheck(challenge, dto.Index);
            if (!decision.Allowed)
            {
                return Conflict(new
                {
                    reason = decision.Reason.ToString(),
                    message = decision.Message,
                    state = StreakRules.Describe(challenge, now)
                });
            }

            StreakRules.ApplyUncheck(challenge, now);
            await _challengesCollection.ReplaceOneAsync(
                x => x.Id == id && x.UserEmail == email, challenge);

            return Ok(new { challenge, state = StreakRules.Describe(challenge, now) });
        }
    }

    public class ChallengeDto
    {
        public string Name { get; set; } = string.Empty;

        /// <summary>Optional. Defaults to today (UTC). Must not be in the past.</summary>
        public DateTime? StartDate { get; set; }
    }

    public class UncheckDto
    {
        /// <summary>Index the client believes is last — guards against a stale UI undoing the wrong day.</summary>
        public int Index { get; set; }
    }
}
