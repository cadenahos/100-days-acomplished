import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ challengeId: 'c1' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return { ...actual, apiFetch: vi.fn() };
});

import ChallengeView from './ChallengeView';
import { apiFetch, ApiError } from '../lib/api';

/** Builds the {challenge, state} payload the real backend returns. */
const payload = ({ done = 0, canCheckNow = true, extra = {} } = {}) => {
  const state = '1'.repeat(done) + '0'.repeat(100 - done);
  return {
    challenge: { id: 'c1', name: 'Morning run', checkboxesState: state },
    state: {
      checkedCount: done,
      nextIndex: done < 100 ? done : null,
      canCheckNow,
      blockedReason: canCheckNow ? null : 'AlreadyCheckedToday',
      blockedMessage: canCheckNow ? null : "You've already checked today.",
      undoableIndex: done > 0 ? done - 1 : null,
      checksUsedToday: 0,
      checksAllowedToday: 1,
      isCatchUpDay: false,
      complete: done >= 100,
      ...extra,
    },
  };
};

const renderView = async (data) => {
  apiFetch.mockResolvedValueOnce(data);
  render(<ChallengeView token="t" logout={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('Morning run')).toBeInTheDocument());
};

describe('ChallengeView grid rules', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks the next day as clickable when a check is allowed', async () => {
    await renderView(payload({ done: 3 }));
    expect(screen.getByTitle(/^Day 4 .* click to check$/)).toBeInTheDocument();
  });

  it('locks days beyond the next one', async () => {
    await renderView(payload({ done: 3 }));
    expect(screen.getByTitle(/^Day 6 .* complete day 5 first$/)).toBeInTheDocument();
  });

  it('locks already-checked days except the most recent', async () => {
    await renderView(payload({ done: 3 }));
    expect(screen.getByTitle(/^Day 1 .* locked$/)).toBeInTheDocument();
    expect(screen.getByTitle(/^Day 3 .* click to undo$/)).toBeInTheDocument();
  });

  it('shows the server message when checking is blocked', async () => {
    await renderView(payload({ done: 3, canCheckNow: false }));
    expect(screen.getByText(/already checked today/i)).toBeInTheDocument();
  });

  it('reports the start-date lock verbatim from the server', async () => {
    await renderView(payload({
      done: 0,
      canCheckNow: false,
      extra: {
        blockedReason: 'NotStartedYet',
        blockedMessage: 'This challenge starts in 7 days, on 2026-08-19.',
        notStartedYet: true,
      },
    }));
    expect(screen.getByText(/starts in 7 days/i)).toBeInTheDocument();
  });

  it('announces a catch-up day', async () => {
    await renderView(payload({
      done: 2,
      extra: { isCatchUpDay: true, checksAllowedToday: 2, checksUsedToday: 0 },
    }));
    expect(screen.getByText(/missed a day/i)).toBeInTheDocument();
  });

  it('shows the start date once the challenge is running', async () => {
    await renderView(payload({ done: 3, extra: { startDateUtc: '2026-08-10T00:00:00Z' } }));
    expect(screen.getByText(/Started .*Aug.*10.*2026/)).toBeInTheDocument();
  });

  it('says "Starts" for a challenge that has not begun', async () => {
    await renderView(payload({
      done: 0,
      canCheckNow: false,
      extra: {
        startDateUtc: '2026-08-19T00:00:00Z',
        notStartedYet: true,
        blockedMessage: 'This challenge starts in 7 days, on 2026-08-19.',
      },
    }));
    expect(screen.getByText(/Starts .*Aug.*19.*2026/)).toBeInTheDocument();
    expect(screen.queryByText(/^Started/)).not.toBeInTheDocument();
  });

  // Midnight UTC formatted in a negative-offset local zone would render the
  // previous day, so the date must be formatted in UTC.
  it('renders the stored UTC date, not a locale-shifted one', async () => {
    await renderView(payload({ done: 1, extra: { startDateUtc: '2026-08-10T00:00:00Z' } }));
    expect(screen.queryByText(/Aug.*9.*2026/)).not.toBeInTheDocument();
    expect(screen.getByText(/Aug.*10.*2026/)).toBeInTheDocument();
  });

  it('omits the line entirely for challenges with no start date', async () => {
    await renderView(payload({ done: 3, extra: { startDateUtc: null } }));
    expect(screen.queryByText(/^Start(s|ed)/)).not.toBeInTheDocument();
  });

  it('shows progress from the server count, not from the raw string', async () => {
    await renderView(payload({ done: 12 }));
    // Scoped to the progress line — a bare getByText('12') would also match
    // the number printed inside box 12 of the grid.
    expect(screen.getByText(/Progress:/i).textContent).toMatch(/12\s*\/\s*100/);
  });

  it('celebrates completion', async () => {
    await renderView(payload({ done: 100, canCheckNow: false, extra: { complete: true } }));
    expect(screen.getByText(/all 100 days complete/i)).toBeInTheDocument();
  });
});

describe('ChallengeView actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs to /check when the next day is clicked', async () => {
    const user = userEvent.setup();
    await renderView(payload({ done: 3 }));
    apiFetch.mockResolvedValueOnce(payload({ done: 4 }));

    await user.click(screen.getByTitle(/^Day 4 .* click to check$/));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenLastCalledWith('/Challenges/c1/check',
        expect.objectContaining({ method: 'POST' }));
    });
  });

  it('does not call the API when a locked day is clicked', async () => {
    const user = userEvent.setup();
    await renderView(payload({ done: 3 }));
    apiFetch.mockClear();

    await user.click(screen.getByTitle(/^Day 8 .* complete day 7 first$/));

    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('POSTs the index to /uncheck when undoing', async () => {
    const user = userEvent.setup();
    await renderView(payload({ done: 3 }));
    apiFetch.mockResolvedValueOnce(payload({ done: 2 }));

    await user.click(screen.getByTitle(/^Day 3 .* click to undo$/));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenLastCalledWith('/Challenges/c1/uncheck',
        expect.objectContaining({ method: 'POST', body: { index: 2 } }));
    });
  });

  it('displays the rule message from a 409 instead of a generic error', async () => {
    const user = userEvent.setup();
    await renderView(payload({ done: 3 }));
    apiFetch.mockRejectedValueOnce(new ApiError('conflict', {
      status: 409,
      body: { reason: 'AlreadyCheckedToday', message: 'Come back tomorrow.' },
    }));

    await user.click(screen.getByTitle(/^Day 4 .* click to check$/));

    expect(await screen.findByText('Come back tomorrow.')).toBeInTheDocument();
  });

  it('logs out on a 401', async () => {
    const user = userEvent.setup();
    const logout = vi.fn();
    apiFetch.mockResolvedValueOnce(payload({ done: 1 }));
    render(<ChallengeView token="t" logout={logout} />);
    await waitFor(() => expect(screen.getByText('Morning run')).toBeInTheDocument());

    apiFetch.mockRejectedValueOnce(new ApiError('unauthorised', { status: 401 }));
    await user.click(screen.getByTitle(/^Day 2 .* click to check$/));

    await waitFor(() => expect(logout).toHaveBeenCalled());
  });
});
