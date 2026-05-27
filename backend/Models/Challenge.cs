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
    }
}
