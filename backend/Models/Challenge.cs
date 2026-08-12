using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Backend.Models
{
    public class Challenge
    {
        [BsonId]
        [BsonRepresentation(BsonType.ObjectId)]
        public string? Id { get; set; }

        public string UserEmail { get; set; } = string.Empty;

        public string Name { get; set; } = string.Empty;

        public string CheckboxesState { get; set; } = new string('0', 100);

        /// <summary>
        /// UTC date the challenge begins, midnight-normalised. Checking is blocked
        /// until this date arrives. Null on documents created before this feature,
        /// which are treated as already started.
        /// </summary>
        [BsonIgnoreIfNull]
        public DateTime? StartDateUtc { get; set; }

        // ------------------------------------------------------------------
        // Streak tracking. BsonIgnoreIfNull / default values keep documents
        // written before this feature readable — Mongo has no migrations, so
        // old challenges simply come back with LastCheckDateUtc = null and
        // behave as if they had never been checked today.
        // ------------------------------------------------------------------

        /// <summary>UTC date of the most recent check, midnight-normalised. Null if never checked.</summary>
        [BsonIgnoreIfNull]
        public DateTime? LastCheckDateUtc { get; set; }

        /// <summary>How many boxes were checked on <see cref="LastCheckDateUtc"/>.</summary>
        [BsonDefaultValue(0)]
        public int ChecksOnLastDate { get; set; }

        /// <summary>
        /// How many checks were permitted on <see cref="LastCheckDateUtc"/>. Normally 1;
        /// 2 when the user had missed the previous day and was catching up.
        /// Stored rather than recomputed so the allowance can't change retroactively.
        /// </summary>
        [BsonDefaultValue(1)]
        public int AllowanceOnLastDate { get; set; } = 1;
    }
}
