import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

vi.mock('@react-oauth/google', () => ({
  GoogleLogin: ({ onSuccess }) => (
    <button onClick={() => onSuccess({ credential: 'fake-token' })}>Sign in with Google</button>
  ),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return { ...actual, apiFetch: vi.fn() };
});

import Home from './Home';
import { apiFetch, ApiError } from '../lib/api';

const todayIso = () => new Date().toISOString().slice(0, 10);
const shiftDays = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const challenge = (id, name, done = 0) => ({
  id,
  name,
  checkboxesState: '1'.repeat(done) + '0'.repeat(100 - done),
});

/** Renders Home with the initial GET /Challenges/my resolved. */
const renderHome = async (existing = []) => {
  apiFetch.mockResolvedValueOnce(existing);
  const logout = vi.fn();
  render(<Home token="t" setToken={vi.fn()} logout={logout} />);
  await waitFor(() => expect(apiFetch).toHaveBeenCalled());
  return { logout };
};

const nameInput = () => screen.getByPlaceholderText(/challenge name/i);
const dateInput = () => screen.getByLabelText(/start date/i);
const createButton = () => screen.getByRole('button', { name: /create challenge/i });

beforeEach(() => {
  vi.clearAllMocks();
  navigate.mockClear();
});

// ---------------------------------------------------------------- signed out

describe('Home when signed out', () => {
  it('shows the sign-in prompt and no create form', () => {
    render(<Home token={null} setToken={vi.fn()} logout={vi.fn()} />);

    expect(screen.getByText(/please sign in/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/challenge name/i)).not.toBeInTheDocument();
  });

  it('does not fetch challenges without a token', () => {
    render(<Home token={null} setToken={vi.fn()} logout={vi.fn()} />);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('stores the credential returned by Google', async () => {
    const user = userEvent.setup();
    const setToken = vi.fn();
    render(<Home token={null} setToken={setToken} logout={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /sign in with google/i }));
    expect(setToken).toHaveBeenCalledWith('fake-token');
  });
});

// ---------------------------------------------------------------- creation

describe('Creating a challenge', () => {
  it('defaults the start date to today and blocks earlier dates', async () => {
    await renderHome();

    expect(dateInput()).toHaveValue(todayIso());
    expect(dateInput()).toHaveAttribute('min', todayIso());
  });

  it('keeps Create disabled until a name is entered', async () => {
    const user = userEvent.setup();
    await renderHome();

    expect(createButton()).toBeDisabled();
    await user.type(nameInput(), 'Morning run');
    expect(createButton()).toBeEnabled();
  });

  it('treats a whitespace-only name as empty', async () => {
    const user = userEvent.setup();
    await renderHome();

    await user.type(nameInput(), '   ');
    expect(createButton()).toBeDisabled();
  });

  it('POSTs the name and start date, then opens the new challenge', async () => {
    const user = userEvent.setup();
    await renderHome();
    apiFetch.mockResolvedValueOnce({ challenge: challenge('new-id', 'Morning run') });

    await user.type(nameInput(), 'Morning run');
    await user.click(createButton());

    await waitFor(() => {
      expect(apiFetch).toHaveBeenLastCalledWith('/Challenges', expect.objectContaining({
        method: 'POST',
        body: { name: 'Morning run', startDate: todayIso() },
      }));
    });
    expect(navigate).toHaveBeenCalledWith('/new-id');
  });

  it('sends a future start date when one is chosen', async () => {
    const user = userEvent.setup();
    await renderHome();
    apiFetch.mockResolvedValueOnce({ challenge: challenge('future-id', 'Later') });

    const future = shiftDays(5);
    await user.type(nameInput(), 'Later');
    await user.clear(dateInput());
    await user.type(dateInput(), future);
    await user.click(createButton());

    await waitFor(() => {
      expect(apiFetch).toHaveBeenLastCalledWith('/Challenges', expect.objectContaining({
        body: { name: 'Later', startDate: future },
      }));
    });
  });

  it('explains that a future start date locks the grid', async () => {
    const user = userEvent.setup();
    await renderHome();

    await user.clear(dateInput());
    await user.type(dateInput(), shiftDays(3));

    expect(screen.getByText(/unlocks on/i)).toBeInTheDocument();
  });

  it('says day 1 is available when starting today', async () => {
    await renderHome();
    expect(screen.getByText(/starting today/i)).toBeInTheDocument();
  });

  it('refuses a past start date without calling the API', async () => {
    const user = userEvent.setup();
    await renderHome();
    apiFetch.mockClear();

    await user.clear(dateInput());
    await user.type(dateInput(), shiftDays(-1));

    expect(screen.getByText(/can't be in the past/i)).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('shows the server message when creation is rejected', async () => {
    const user = userEvent.setup();
    await renderHome();
    apiFetch.mockRejectedValueOnce(new ApiError('bad request', {
      status: 400,
      body: { message: "The start date can't be in the past. Choose 2026-08-12 or later." },
    }));

    await user.type(nameInput(), 'Whatever');
    await user.click(createButton());

    expect(await screen.findByText(/start date can't be in the past/i)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('logs out if creation returns 401', async () => {
    const user = userEvent.setup();
    const { logout } = await renderHome();
    apiFetch.mockRejectedValueOnce(new ApiError('unauthorised', { status: 401 }));

    await user.type(nameInput(), 'Whatever');
    await user.click(createButton());

    await waitFor(() => expect(logout).toHaveBeenCalled());
  });
});

// ---------------------------------------------------------------- selection

describe('Selecting a challenge', () => {
  it('lists the challenges returned by the API', async () => {
    await renderHome([challenge('a', 'Morning run'), challenge('b', 'Read daily')]);

    expect(await screen.findByText('Morning run')).toBeInTheDocument();
    expect(screen.getByText('Read daily')).toBeInTheDocument();
  });

  it('hides the section entirely when there are none', async () => {
    await renderHome([]);
    expect(screen.queryByText(/your challenges/i)).not.toBeInTheDocument();
  });

  it('navigates to the challenge when its card is clicked', async () => {
    const user = userEvent.setup();
    await renderHome([challenge('a', 'Morning run'), challenge('b', 'Read daily')]);

    await user.click(await screen.findByText('Read daily'));
    expect(navigate).toHaveBeenCalledWith('/b');
  });

  it('navigates to the right one when several exist', async () => {
    const user = userEvent.setup();
    await renderHome([
      challenge('a', 'First'), challenge('b', 'Second'), challenge('c', 'Third'),
    ]);

    await user.click(await screen.findByText('Third'));
    expect(navigate).toHaveBeenCalledWith('/c');
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  // The delete control sits on top of the card; clicking it must not navigate.
  it('opens the confirm dialog instead of navigating when Delete is clicked', async () => {
    const user = userEvent.setup();
    await renderHome([challenge('a', 'Morning run', 12)]);

    await user.click(await screen.findByRole('button', { name: /delete challenge morning run/i }));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('warns how much progress a delete would lose', async () => {
    const user = userEvent.setup();
    await renderHome([challenge('a', 'Morning run', 12)]);

    await user.click(await screen.findByRole('button', { name: /delete challenge/i }));
    expect(within(screen.getByRole('alertdialog')).getByText(/12 days of progress/i))
      .toBeInTheDocument();
  });

  it('removes the card after a confirmed delete', async () => {
    const user = userEvent.setup();
    await renderHome([challenge('a', 'Morning run'), challenge('b', 'Read daily')]);
    apiFetch.mockResolvedValueOnce(null);

    await user.click(await screen.findByRole('button', { name: /delete challenge morning run/i }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByText('Morning run')).not.toBeInTheDocument());
    expect(screen.getByText('Read daily')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenLastCalledWith('/Challenges/a',
      expect.objectContaining({ method: 'DELETE' }));
  });

  it('keeps the card when the delete is cancelled', async () => {
    const user = userEvent.setup();
    await renderHome([challenge('a', 'Morning run')]);
    apiFetch.mockClear();

    await user.click(await screen.findByRole('button', { name: /delete challenge/i }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('Morning run')).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- loading list

describe('Loading the challenge list', () => {
  it('logs out when the list returns 401', async () => {
    const logout = vi.fn();
    apiFetch.mockRejectedValueOnce(new ApiError('unauthorised', { status: 401 }));
    render(<Home token="t" setToken={vi.fn()} logout={logout} />);

    await waitFor(() => expect(logout).toHaveBeenCalled());
  });

  it('surfaces an unreachable API', async () => {
    apiFetch.mockRejectedValueOnce(new ApiError('Network failure — could not reach the API.', {}));
    render(<Home token="t" setToken={vi.fn()} logout={vi.fn()} />);

    expect(await screen.findByText(/can't reach the api/i)).toBeInTheDocument();
  });
});
