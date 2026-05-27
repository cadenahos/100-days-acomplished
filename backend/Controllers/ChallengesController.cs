using System.Security.Claims;
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

        public ChallengesController(IMongoClient mongoClient, IOptions<ChallengeDatabaseSettings> settings)
        {
            var mongoDatabase = mongoClient.GetDatabase(settings.Value.DatabaseName);
            _challengesCollection = mongoDatabase.GetCollection<Challenge>(settings.Value.ChallengesCollectionName);
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

            var challenge = new Challenge
            {
                UserEmail = email,
                Name = dto.Name,
                CheckboxesState = new string('0', 100)
            };

            await _challengesCollection.InsertOneAsync(challenge);

            return CreatedAtAction(nameof(GetChallenge), new { id = challenge.Id }, challenge);
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<Challenge>> GetChallenge(string id)
        {
            var email = GetUserEmail();
            var challenge = await _challengesCollection.Find(x => x.Id == id && x.UserEmail == email).FirstOrDefaultAsync();

            if (challenge == null)
            {
                return NotFound();
            }

            return challenge;
        }

        [HttpGet("my")]
        public async Task<ActionResult<List<Challenge>>> GetMyChallenges()
        {
            var email = GetUserEmail();
            var challenges = await _challengesCollection.Find(x => x.UserEmail == email).ToListAsync();
            return challenges;
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> UpdateChallenge(string id, [FromBody] ChallengeUpdateDto dto)
        {
            var email = GetUserEmail();
            var challenge = await _challengesCollection.Find(x => x.Id == id && x.UserEmail == email).FirstOrDefaultAsync();

            if (challenge == null)
            {
                return NotFound();
            }

            if (dto.CheckboxesState.Length != 100)
            {
                return BadRequest("State must be exactly 100 characters long.");
            }

            challenge.CheckboxesState = dto.CheckboxesState;
            await _challengesCollection.ReplaceOneAsync(x => x.Id == id && x.UserEmail == email, challenge);

            return NoContent();
        }
    }

    public class ChallengeDto
    {
        public string Name { get; set; } = string.Empty;
    }

    public class ChallengeUpdateDto
    {
        public string CheckboxesState { get; set; } = string.Empty;
    }
}
