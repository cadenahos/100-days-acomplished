using Backend.Domain;
using Backend.Models;
using Xunit;

namespace Backend.Tests;

/// <summary>
/// The rules are entirely date-driven, so every test pins an explicit "now"
/// rather than using DateTime.UtcNow. A test that depends on the wall clock
/// would pass all day and fail at midnight.
/// </summary>
public class StreakRulesTests
{
    private static readonly DateTime D0 = new(2026, 8, 10, 0, 0, 0, DateTimeKind.Utc);
    private static DateTime Day(int n) => D0.AddDays(n);

    private static Challenge NewChallenge(
        string? state = null,
        DateTime? lastCheck = null,
        int checksOnLast = 0,
        int allowanceOnLast = 1,
        DateTime? startDate = null) => new()
        {
            Id = "test-id",
            UserEmail = "someone@example.com",
            Name = "Test",
            CheckboxesState = state ?? new string('0', 100),
            LastCheckDateUtc = lastCheck,
            ChecksOnLastDate = checksOnLast,
            AllowanceOnLastDate = allowanceOnLast,
            StartDateUtc = startDate
        };

    // ---------------------------------------------------------------- counting

    [Theory]
    [InlineData("", 0)]
    [InlineData("0", 0)]
    [InlineData("1", 1)]
    [InlineData("111", 3)]
    [InlineData("1101", 2)]   // stops at the gap — never counts past a zero
    [InlineData("0111", 0)]
    public void CheckedCount_counts_only_the_leading_run(string state, int expected)
        => Assert.Equal(expected, StreakRules.CheckedCount(state));

    [Fact]
    public void NextIndex_is_the_first_unchecked_box()
    {
        Assert.Equal(0, StreakRules.NextIndex(new string('0', 100)));
        Assert.Equal(3, StreakRules.NextIndex("111" + new string('0', 97)));
    }

    [Fact]
    public void NextIndex_is_null_when_all_hundred_are_done()
        => Assert.Null(StreakRules.NextIndex(new string('1', 100)));

    // ---------------------------------------------------------------- first check

    [Fact]
    public void First_ever_check_is_allowed()
        => Assert.True(StreakRules.CanCheck(NewChallenge(), D0).Allowed);

    [Fact]
    public void First_check_marks_day_one_and_records_the_date()
    {
        var c = NewChallenge();
        StreakRules.ApplyCheck(c, D0);

        Assert.Equal(1, StreakRules.CheckedCount(c.CheckboxesState));
        Assert.Equal('1', c.CheckboxesState[0]);
        Assert.Equal(D0.Date, c.LastCheckDateUtc);
        Assert.Equal(1, c.ChecksOnLastDate);
        Assert.Equal(1, c.AllowanceOnLastDate);
    }

    // ---------------------------------------------------------------- one per day

    [Fact]
    public void Second_check_on_the_same_day_is_denied()
    {
        var c = NewChallenge();
        StreakRules.ApplyCheck(c, D0);

        var decision = StreakRules.CanCheck(c, D0);
        Assert.False(decision.Allowed);
        Assert.Equal(CheckDenialReason.AlreadyCheckedToday, decision.Reason);
    }

    [Fact]
    public void Checking_the_next_day_is_allowed()
    {
        var c = NewChallenge();
        StreakRules.ApplyCheck(c, D0);

        Assert.True(StreakRules.CanCheck(c, Day(1)).Allowed);
        StreakRules.ApplyCheck(c, Day(1));
        Assert.Equal(2, StreakRules.CheckedCount(c.CheckboxesState));
        Assert.Equal(1, c.AllowanceOnLastDate);   // consecutive day, no catch-up
    }

    // ---------------------------------------------------------------- catch-up

    [Theory]
    [InlineData(0, 1)]    // same day
    [InlineData(1, 1)]    // yesterday — normal streak
    [InlineData(2, 2)]    // missed one day — catch up
    [InlineData(9, 2)]    // missed many — still only 2, never more
    [InlineData(60, 2)]
    public void Allowance_is_two_only_after_missing_a_day(int gapDays, int expected)
        => Assert.Equal(expected, StreakRules.AllowanceFor(D0, D0.AddDays(gapDays)));

    [Fact]
    public void Allowance_is_one_when_nothing_was_ever_checked()
        => Assert.Equal(1, StreakRules.AllowanceFor(null, D0));

    [Fact]
    public void After_missing_a_day_two_checks_are_permitted_then_no_more()
    {
        var c = NewChallenge();
        StreakRules.ApplyCheck(c, D0);

        // Skip Day(1) entirely, return on Day(2).
        Assert.True(StreakRules.CanCheck(c, Day(2)).Allowed);
        StreakRules.ApplyCheck(c, Day(2));
        Assert.Equal(2, c.AllowanceOnLastDate);

        Assert.True(StreakRules.CanCheck(c, Day(2)).Allowed);
        StreakRules.ApplyCheck(c, Day(2));
        Assert.Equal(3, StreakRules.CheckedCount(c.CheckboxesState));

        var third = StreakRules.CanCheck(c, Day(2));
        Assert.False(third.Allowed);
        Assert.Equal(CheckDenialReason.AlreadyCheckedToday, third.Reason);
    }

    [Fact]
    public void Checks_never_leave_a_gap_in_the_state()
    {
        var c = NewChallenge();
        for (var i = 0; i < 10; i++) StreakRules.ApplyCheck(c, Day(i));

        Assert.Equal(new string('1', 10), c.CheckboxesState[..10]);
        Assert.Equal('0', c.CheckboxesState[10]);
    }

    // ---------------------------------------------------------------- completion

    [Fact]
    public void A_complete_challenge_rejects_further_checks()
    {
        var c = NewChallenge(new string('1', 100), lastCheck: D0, checksOnLast: 1);

        var decision = StreakRules.CanCheck(c, Day(1));
        Assert.False(decision.Allowed);
        Assert.Equal(CheckDenialReason.ChallengeComplete, decision.Reason);
    }

    [Fact]
    public void ApplyCheck_throws_if_called_on_a_complete_challenge()
        => Assert.Throws<InvalidOperationException>(
            () => StreakRules.ApplyCheck(NewChallenge(new string('1', 100)), D0));

    // ---------------------------------------------------------------- unchecking

    [Fact]
    public void Only_the_most_recent_day_can_be_undone()
    {
        var c = NewChallenge();
        StreakRules.ApplyCheck(c, D0);
        StreakRules.ApplyCheck(c, Day(1));
        StreakRules.ApplyCheck(c, Day(2));

        var earlier = StreakRules.CanUncheck(c, 0);
        Assert.False(earlier.Allowed);
        Assert.Equal(CheckDenialReason.NotTheLastCheck, earlier.Reason);

        Assert.True(StreakRules.CanUncheck(c, 2).Allowed);
    }

    [Fact]
    public void Unchecking_an_empty_challenge_is_denied()
    {
        var decision = StreakRules.CanUncheck(NewChallenge(), 0);
        Assert.False(decision.Allowed);
        Assert.Equal(CheckDenialReason.NothingToUncheck, decision.Reason);
    }

    [Fact]
    public void Undoing_a_check_made_today_refunds_todays_quota()
    {
        var c = NewChallenge();
        StreakRules.ApplyCheck(c, D0);
        Assert.False(StreakRules.CanCheck(c, D0).Allowed);

        StreakRules.ApplyUncheck(c, D0);

        Assert.Equal(0, StreakRules.CheckedCount(c.CheckboxesState));
        Assert.True(StreakRules.CanCheck(c, D0).Allowed);
    }

    [Fact]
    public void Undoing_a_check_made_on_an_earlier_day_does_not_refund_today()
    {
        var c = NewChallenge();
        StreakRules.ApplyCheck(c, D0);

        StreakRules.ApplyUncheck(c, Day(2));

        // The day is undone, but D0's record is untouched — no free extra check.
        Assert.Equal(0, StreakRules.CheckedCount(c.CheckboxesState));
        Assert.Equal(D0.Date, c.LastCheckDateUtc);
        Assert.Equal(1, c.ChecksOnLastDate);
    }

    [Fact]
    public void Undo_then_redo_in_one_day_is_net_neutral()
    {
        var c = NewChallenge();
        StreakRules.ApplyCheck(c, D0);
        StreakRules.ApplyCheck(c, Day(1));

        StreakRules.ApplyUncheck(c, Day(1));
        StreakRules.ApplyCheck(c, Day(1));

        Assert.Equal(2, StreakRules.CheckedCount(c.CheckboxesState));
        // Crucially, still blocked afterwards — undo/redo cannot farm extra days.
        Assert.False(StreakRules.CanCheck(c, Day(1)).Allowed);
    }

    // ---------------------------------------------------------------- start date

    [Fact]
    public void A_challenge_starting_today_can_be_checked_immediately()
        => Assert.True(StreakRules.CanCheck(NewChallenge(startDate: D0), D0).Allowed);

    [Fact]
    public void A_challenge_starting_tomorrow_is_locked()
    {
        var decision = StreakRules.CanCheck(NewChallenge(startDate: Day(1)), D0);

        Assert.False(decision.Allowed);
        Assert.Equal(CheckDenialReason.NotStartedYet, decision.Reason);
        Assert.Contains("tomorrow", decision.Message);
    }

    [Fact]
    public void A_challenge_starting_later_reports_the_number_of_days()
    {
        var decision = StreakRules.CanCheck(NewChallenge(startDate: Day(7)), D0);

        Assert.False(decision.Allowed);
        Assert.Contains("7 days", decision.Message);
    }

    [Fact]
    public void The_lock_lifts_on_the_start_date()
    {
        var c = NewChallenge(startDate: Day(7));

        Assert.False(StreakRules.CanCheck(c, Day(6)).Allowed);
        Assert.True(StreakRules.CanCheck(c, Day(7)).Allowed);
        Assert.True(StreakRules.CanCheck(c, Day(8)).Allowed);
    }

    [Fact]
    public void Challenges_saved_before_start_dates_existed_are_not_locked()
        => Assert.True(StreakRules.CanCheck(NewChallenge(startDate: null), D0).Allowed);

    [Fact]
    public void Completion_takes_precedence_over_the_start_date_lock()
    {
        var c = NewChallenge(new string('1', 100), startDate: Day(7));

        Assert.Equal(CheckDenialReason.ChallengeComplete, StreakRules.CanCheck(c, D0).Reason);
    }

    // ---------------------------------------------------------------- time of day

    [Fact]
    public void Two_checks_at_different_times_on_the_same_date_still_count_as_one_day()
    {
        var c = NewChallenge();
        var morning = new DateTime(2026, 8, 10, 7, 0, 0, DateTimeKind.Utc);
        var night = new DateTime(2026, 8, 10, 23, 59, 0, DateTimeKind.Utc);

        StreakRules.ApplyCheck(c, morning);

        Assert.False(StreakRules.CanCheck(c, night).Allowed);
    }

    [Fact]
    public void One_minute_past_midnight_counts_as_the_next_day()
    {
        var c = NewChallenge();
        var night = new DateTime(2026, 8, 10, 23, 59, 0, DateTimeKind.Utc);
        var justAfter = new DateTime(2026, 8, 11, 0, 1, 0, DateTimeKind.Utc);

        StreakRules.ApplyCheck(c, night);

        Assert.True(StreakRules.CanCheck(c, justAfter).Allowed);
    }
}
