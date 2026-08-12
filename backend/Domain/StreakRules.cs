using Backend.Models;

namespace Backend.Domain
{
    public enum CheckDenialReason
    {
        None,
        ChallengeComplete,
        AlreadyCheckedToday,
        NotTheNextDay,
        NothingToUncheck,
        NotTheLastCheck,
        NotStartedYet
    }

    public record CheckDecision(bool Allowed, CheckDenialReason Reason, string Message)
    {
        public static CheckDecision Ok() => new(true, CheckDenialReason.None, "");
        public static CheckDecision No(CheckDenialReason r, string m) => new(false, r, m);
    }

    /// <summary>
    /// The rules of the challenge, kept free of MongoDB and HTTP so they can be
    /// reasoned about and tested directly.
    ///
    /// Two rules, both enforced server-side:
    ///   1. Sequential — you may only check the first unchecked box, and may only
    ///      uncheck the most recently checked one. No gaps, ever.
    ///   2. One per real day, with catch-up — normally one check per UTC day. If
    ///      you missed at least one day, you get an allowance of 2 that day so a
    ///      single lapse doesn't strand the challenge.
    /// </summary>
    public static class StreakRules
    {
        public const int TotalDays = 100;

        /// <summary>Number of consecutive checked boxes from the start.</summary>
        public static int CheckedCount(string state)
        {
            if (string.IsNullOrEmpty(state)) return 0;
            var n = 0;
            foreach (var c in state)
            {
                if (c != '1') break;
                n++;
            }
            return n;
        }

        /// <summary>Index of the box that may be checked next, or null when complete.</summary>
        public static int? NextIndex(string state)
        {
            var n = CheckedCount(state);
            return n >= TotalDays ? null : n;
        }

        /// <summary>
        /// How many checks are permitted on <paramref name="today"/>, given the last
        /// check date. 2 when the previous day was missed (catch-up), otherwise 1.
        /// </summary>
        public static int AllowanceFor(DateTime? lastCheckDateUtc, DateTime today)
        {
            if (lastCheckDateUtc is null) return 1;           // first ever check
            var gap = (today.Date - lastCheckDateUtc.Value.Date).Days;
            return gap >= 2 ? 2 : 1;                          // missed yesterday → catch up
        }

        public static CheckDecision CanCheck(Challenge challenge, DateTime nowUtc)
        {
            var today = nowUtc.Date;

            if (NextIndex(challenge.CheckboxesState) is null)
                return CheckDecision.No(CheckDenialReason.ChallengeComplete,
                    "All 100 days are complete.");

            // A challenge scheduled to begin later is read-only until that day.
            if (challenge.StartDateUtc is { } start && today < start.Date)
            {
                var days = (start.Date - today).Days;
                return CheckDecision.No(CheckDenialReason.NotStartedYet,
                    days == 1
                        ? "This challenge starts tomorrow."
                        : $"This challenge starts in {days} days, on {start.Date:yyyy-MM-dd}.");
            }

            // A different day than the last check: the counter resets.
            if (challenge.LastCheckDateUtc?.Date != today)
                return CheckDecision.Ok();

            // Same day: only allowed if the stored allowance isn't used up.
            if (challenge.ChecksOnLastDate < challenge.AllowanceOnLastDate)
                return CheckDecision.Ok();

            return CheckDecision.No(CheckDenialReason.AlreadyCheckedToday,
                challenge.AllowanceOnLastDate > 1
                    ? "You've already caught up today. The next day unlocks tomorrow."
                    : "You've already checked today. The next day unlocks tomorrow.");
        }

        /// <summary>Applies a check. Call only after <see cref="CanCheck"/> allows it.</summary>
        public static void ApplyCheck(Challenge challenge, DateTime nowUtc)
        {
            var today = nowUtc.Date;
            var index = NextIndex(challenge.CheckboxesState)
                        ?? throw new InvalidOperationException("Challenge is already complete.");

            var chars = challenge.CheckboxesState.ToCharArray();
            chars[index] = '1';
            challenge.CheckboxesState = new string(chars);

            if (challenge.LastCheckDateUtc?.Date == today)
            {
                challenge.ChecksOnLastDate++;
            }
            else
            {
                // Lock in today's allowance before overwriting the last check date.
                challenge.AllowanceOnLastDate = AllowanceFor(challenge.LastCheckDateUtc, today);
                challenge.LastCheckDateUtc = today;
                challenge.ChecksOnLastDate = 1;
            }
        }

        public static CheckDecision CanUncheck(Challenge challenge, int index)
        {
            var checkedCount = CheckedCount(challenge.CheckboxesState);

            if (checkedCount == 0)
                return CheckDecision.No(CheckDenialReason.NothingToUncheck,
                    "Nothing has been checked yet.");

            if (index != checkedCount - 1)
                return CheckDecision.No(CheckDenialReason.NotTheLastCheck,
                    $"Only day {checkedCount} can be undone — earlier days are locked.");

            return CheckDecision.Ok();
        }

        /// <summary>Undoes the most recent check, refunding today's allowance if it was used today.</summary>
        public static void ApplyUncheck(Challenge challenge, DateTime nowUtc)
        {
            var index = CheckedCount(challenge.CheckboxesState) - 1;
            if (index < 0) throw new InvalidOperationException("Nothing to uncheck.");

            var chars = challenge.CheckboxesState.ToCharArray();
            chars[index] = '0';
            challenge.CheckboxesState = new string(chars);

            // Refund only if the check being undone happened today; otherwise the
            // user could undo an old day to farm extra checks.
            if (challenge.LastCheckDateUtc?.Date == nowUtc.Date && challenge.ChecksOnLastDate > 0)
            {
                challenge.ChecksOnLastDate--;
                if (challenge.ChecksOnLastDate == 0) challenge.LastCheckDateUtc = null;
            }
        }

        /// <summary>Everything the UI needs to render state without duplicating the rules.</summary>
        public static object Describe(Challenge challenge, DateTime nowUtc)
        {
            var canCheck = CanCheck(challenge, nowUtc);
            var next = NextIndex(challenge.CheckboxesState);
            var checkedCount = CheckedCount(challenge.CheckboxesState);
            var today = nowUtc.Date;
            var usedToday = challenge.LastCheckDateUtc?.Date == today ? challenge.ChecksOnLastDate : 0;
            var allowanceToday = challenge.LastCheckDateUtc?.Date == today
                ? challenge.AllowanceOnLastDate
                : AllowanceFor(challenge.LastCheckDateUtc, today);

            var notStarted = canCheck.Reason == CheckDenialReason.NotStartedYet;

            return new
            {
                checkedCount,
                nextIndex = next,
                canCheckNow = canCheck.Allowed,
                blockedReason = canCheck.Allowed ? null : canCheck.Reason.ToString(),
                blockedMessage = canCheck.Allowed ? null : canCheck.Message,
                undoableIndex = checkedCount > 0 ? checkedCount - 1 : (int?)null,
                checksUsedToday = usedToday,
                checksAllowedToday = allowanceToday,
                isCatchUpDay = allowanceToday > 1,
                startDateUtc = challenge.StartDateUtc,
                notStartedYet = notStarted,
                // When it hasn't started, the unlock is the start date, not tomorrow.
                nextUnlockUtc = canCheck.Allowed
                    ? null
                    : notStarted ? challenge.StartDateUtc : (DateTime?)today.AddDays(1),
                complete = next is null
            };
        }
    }
}
