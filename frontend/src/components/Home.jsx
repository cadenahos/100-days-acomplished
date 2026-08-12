import { useState, useEffect } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';
import ConfirmDialog from './ConfirmDialog';

// Today in YYYY-MM-DD. Uses UTC because the backend validates against UTC —
// deriving this from local time would let someone in UTC+13 pick a date the
// server still considers yesterday and get a confusing rejection.
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function Home({ token, setToken, logout }) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [myChallenges, setMyChallenges] = useState([]);
  const [error, setError] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    apiFetch('/Challenges/my', { token })
      .then(data => {
        if (cancelled) return;
        setError(null);
        if (Array.isArray(data)) setMyChallenges(data);
      })
      .catch(err => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          logout();
          return;
        }
        setError(describe(err));
      });

    return () => { cancelled = true; };
  }, [token, logout]);

  const startsInPast = startDate < todayIso();

  const handleCreate = async () => {
    if (!name.trim() || !token || startsInPast) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/Challenges', {
        token,
        method: 'POST',
        body: { name, startDate },
      });
      const id = data?.challenge?.id ?? data?.id;
      if (id) navigate(`/${id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      // The server sends a readable reason for a rejected start date.
      if (err instanceof ApiError && err.status === 400 && err.body?.message) {
        setError(err.body.message);
        return;
      }
      setError(describe(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setError(null);
    const id = pendingDelete.id;
    try {
      await apiFetch(`/Challenges/${id}`, { token, method: 'DELETE' });
      setMyChallenges(list => list.filter(c => c.id !== id));
      setPendingDelete(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      // Already gone — treat as success rather than showing a confusing error.
      if (err instanceof ApiError && err.status === 404) {
        setMyChallenges(list => list.filter(c => c.id !== id));
        setPendingDelete(null);
        return;
      }
      setError('Could not delete that challenge. It is still there — try again.');
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  if (!token) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-white/10 backdrop-blur-lg rounded-3xl shadow-2xl border border-white/20">
        <h1 className="text-4xl font-extrabold mb-8 bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400">
          Welcome to 100 Days
        </h1>
        <p className="mb-8 text-indigo-200">Please sign in to track your challenges.</p>
        <GoogleLogin
          onSuccess={credentialResponse => {
            setToken(credentialResponse.credential);
          }}
          onError={() => {
            console.error('Login Failed');
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center w-full max-w-7xl pt-12 pb-24 px-4 gap-12 transition-all duration-500 relative min-h-[80vh]">
      
      <button 
        onClick={logout}
        className="absolute top-0 right-0 text-sm font-bold text-red-400 hover:text-red-200 bg-red-900/30 hover:bg-red-800/50 px-5 py-2 rounded-xl transition-all"
      >
        Sign Out
      </button>

      {error && (
        <div className="w-full max-w-2xl rounded-2xl border border-red-500/40 bg-red-950/50 px-6 py-4 text-red-200">
          <p className="font-bold mb-1">Can&apos;t reach the API</p>
          <p className="text-sm opacity-90">{error}</p>
          <p className="text-xs opacity-70 mt-2">
            Open the browser console and run <code>__apiDiagnostics()</code> to see
            which layer is failing.
          </p>
        </div>
      )}

      {/* Input Section */}
      <div className="w-full flex flex-col items-center">
        <h1 className="text-5xl font-extrabold mb-12 text-center bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400">
          100 Days Challenge
        </h1>
        
        <div className="flex flex-col gap-6 w-full max-w-xl">
          <h3 className="text-2xl font-bold text-indigo-200 text-center">Start a New Challenge</h3>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter challenge name..."
            className="w-full px-6 py-5 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-xl"
          />

          <div className="flex flex-col gap-2">
            <label htmlFor="startDate" className="text-sm font-medium text-indigo-200/80 px-2">
              Start date
            </label>
            <input
              id="startDate"
              type="date"
              value={startDate}
              min={todayIso()}
              onChange={(e) => setStartDate(e.target.value)}
              className={`w-full px-6 py-4 rounded-2xl bg-white/5 border text-white text-lg
                focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all
                [color-scheme:dark]
                ${startsInPast ? 'border-red-500/60' : 'border-white/10'}`}
            />
            {startsInPast ? (
              <p className="text-xs text-red-300 px-2">
                The start date can&apos;t be in the past.
              </p>
            ) : startDate > todayIso() ? (
              <p className="text-xs text-indigo-300/70 px-2">
                Day 1 unlocks on {startDate}. Until then the grid stays locked.
              </p>
            ) : (
              <p className="text-xs text-indigo-300/70 px-2">
                Starting today — you can check day 1 right away.
              </p>
            )}
          </div>

          <button
            onClick={handleCreate}
            disabled={loading || !name.trim() || startsInPast}
            className="w-full py-5 rounded-2xl font-bold text-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 transform hover:-translate-y-1 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-lg shadow-indigo-500/30"
          >
            {loading ? 'Creating...' : 'Create Challenge'}
          </button>
        </div>
      </div>

      {/* Challenges Section */}
      {myChallenges.length > 0 && (
        <div className="w-full mt-10">
          <div className="flex items-center gap-4 mb-10">
            <div className="h-px bg-white/20 flex-1"></div>
            <h3 className="text-3xl font-bold text-indigo-200 text-center uppercase tracking-widest">Your Challenges</h3>
            <div className="h-px bg-white/20 flex-1"></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {myChallenges.map(c => (
              // The delete control is a SIBLING of the card button, not nested
              // inside it — a <button> within a <button> is invalid HTML and
              // browsers handle the click target inconsistently.
              <div key={c.id} className="relative group">
                <button
                  onClick={() => navigate(`/${c.id}`)}
                  className="w-full p-8 pr-14 bg-indigo-900/40 hover:bg-indigo-800/80 rounded-2xl text-center border border-indigo-500/30 transition-all hover:-translate-y-2 font-bold shadow-lg shadow-indigo-900/20 text-2xl truncate"
                >
                  {c.name}
                </button>

                <button
                  onClick={() => setPendingDelete(c)}
                  aria-label={`Delete challenge ${c.name}`}
                  title="Delete challenge"
                  className="absolute top-3 right-3 p-2 rounded-lg text-indigo-300/50
                             hover:text-red-300 hover:bg-red-950/60
                             focus:outline-none focus:ring-2 focus:ring-red-400 focus:opacity-100
                             opacity-0 group-hover:opacity-100 transition-all"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this challenge?"
        message={`"${pendingDelete?.name}" will be permanently deleted.`}
        detail={
          progressOf(pendingDelete) > 0
            ? `You'll lose ${progressOf(pendingDelete)} day${progressOf(pendingDelete) === 1 ? '' : 's'} of progress. This can't be undone.`
            : "This can't be undone."
        }
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}

/** Days completed, counted the same way the backend does: consecutively from the start. */
function progressOf(challenge) {
  const state = challenge?.checkboxesState;
  if (!state) return 0;
  let n = 0;
  for (const ch of state) {
    if (ch !== '1') break;
    n++;
  }
  return n;
}

function describe(err) {
  if (err instanceof ApiError) {
    if (!err.status) return 'The request never reached the server (network/proxy failure).';
    if (err.status === 503) return 'The API proxy is up but the backend or its database is not responding.';
    return `Server responded ${err.status}.`;
  }
  return String(err?.message ?? err);
}
