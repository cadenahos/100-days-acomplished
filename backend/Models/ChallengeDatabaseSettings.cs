namespace Backend.Models
{
    public class ChallengeDatabaseSettings
    {
        public string ConnectionString { get; set; } = null!;
        public string DatabaseName { get; set; } = null!;
        public string ChallengesCollectionName { get; set; } = null!;
    }
}
