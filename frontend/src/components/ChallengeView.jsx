import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';

export default function ChallengeView({ token, logout }) {
  const { challengeId } = useParams();
  const navigate = useNavigate();
  const [challenge, setChallenge] = useState(null);
  const [rules, setRules] = useState(null);   // server's evaluation of what's allowed
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleError = useCallback((err, fallback) => {
    if (err instanceof ApiError && err.status === 401) {
      logout();
      return;
    }
    // 409 = the server refused because of the streak rules, and told us why.
    if (err instanceof ApiError && err.status === 409 && err.body?.message) {
      setNotice(err.body.message);
      if (err.body.state) setRules(err.body.state);
      return;
    }
    setError(fallback);
  }, [logout]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    apiFetch(`/Challenges/${challengeId}`, { token })
      .then(data => {
        if (cancelled) return;
        setChallenge(data.challenge);
        setRules(data.state);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) { logout(); return; }
        setError(err instanceof ApiError && err.status === 404
          ? 'Challenge not found.'
          : 'Could not load this challenge — the API is unreachable. Run __apiDiagnostics() in the console.');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [challengeId, token, logout]);

  const checkNextDay = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const data = await apiFetch(`/Challenges/${challengeId}/check`, { token, method: 'POST' });
      setChallenge(data.challenge);
      setRules(data.state);
      setError(null);
    } catch (err) {
      handleError(err, 'Could not save that check.');
    } finally {
      setBusy(false);
    }
  };

  const undoLast = async () => {
    if (busy || rules?.undoableIndex == null) return;
    setBusy(true);
    setNotice(null);
    try {
      const data = await apiFetch(`/Challenges/${challengeId}/uncheck`, {
        token, method: 'POST', body: { index: rules.undoableIndex },
      });
      setChallenge(data.challenge);
      setRules(data.state);
      setError(null);
    } catch (err) {
      handleError(err, 'Could not undo that day.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="text-2xl animate-pulse text-indigo-300">Loading...</div>;
  }

  if (!challenge) {
    return <div className="text-red-400">{error ?? 'Challenge not found.'}</div>;
  }

  const boxes = challenge.checkboxesState.split('');
  const nextIndex = rules?.nextIndex ?? null;
  const undoableIndex = rules?.undoableIndex ?? null;

  return (
    <div className="flex flex-col items-center w-full max-w-5xl p-8 bg-white/5 backdrop-blur-md rounded-3xl border border-white/10 shadow-2xl relative">
      <button
        onClick={() => navigate('/')}
        className="absolute top-6 left-6 p-2 bg-white/5 hover:bg-white/10 rounded-full transition-colors flex items-center justify-center text-indigo-300 hover:text-white"
        title="Back to Home"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
      </button>

      <h2 className="text-5xl font-black mb-3 mt-8 md:mt-0 text-center bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-indigo-400 tracking-tight">
        {challenge.name}
      </h2>

      <StartDateLine rules={rules} />

      <StatusLine rules={rules} />

      <div className="grid grid-cols-10 gap-3 sm:gap-4 md:gap-5 mt-10">
        {boxes.map((state, index) => {
          const isChecked = state === '1';
          const isNext = index === nextIndex;
          const isUndoable = index === undoableIndex;
          const clickable = (isNext && rules?.canCheckNow) || isUndoable;

          let style;
          if (isChecked) {
            style = 'bg-gradient-to-br from-green-400 to-emerald-600 shadow-[0_0_15px_rgba(52,211,153,0.5)] border-transparent';
          } else if (isNext && rules?.canCheckNow) {
            style = 'bg-indigo-500/30 border-2 border-indigo-300 animate-pulse shadow-[0_0_20px_rgba(129,140,248,0.6)]';
          } else if (isNext) {
            style = 'bg-white/10 border-2 border-dashed border-white/30';
          } else {
            style = 'bg-white/5 border border-white/10 opacity-40';
          }

          return (
            <div
              key={index}
              onClick={() => {
                if (!clickable) return;
                isUndoable && isChecked ? undoLast() : checkNextDay();
              }}
              title={
                isUndoable ? `Day ${index + 1} — click to undo`
                  : isNext && rules?.canCheckNow ? `Day ${index + 1} — click to check`
                  : isChecked ? `Day ${index + 1} — locked`
                  : `Day ${index + 1} — complete day ${index} first`
              }
              className={`relative flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14
                rounded-xl transition-all duration-300 ${style}
                ${clickable && !busy ? 'cursor-pointer transform hover:scale-110' : 'cursor-not-allowed'}`}
            >
              <span className={`text-xs sm:text-sm font-bold ${isChecked ? 'text-white' : 'text-white/40'}`}>
                {index + 1}
              </span>
              {isChecked && (
                <svg className="absolute inset-0 m-auto w-6 h-6 text-white opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          );
        })}
      </div>

      {notice && (
        <div className="mt-8 w-full max-w-2xl rounded-2xl border border-amber-500/40 bg-amber-950/40 px-6 py-3 text-sm text-amber-200 text-center">
          {notice}
        </div>
      )}

      {error && (
        <div className="mt-8 w-full max-w-2xl rounded-2xl border border-red-500/40 bg-red-950/50 px-6 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="mt-10 text-lg font-medium text-indigo-200">
        Progress: <span className="text-white font-bold">{rules?.checkedCount ?? 0}</span> / 100 Days
      </div>

      {undoableIndex != null && (
        <button
          onClick={undoLast}
          disabled={busy}
          className="mt-4 text-xs text-indigo-300/70 hover:text-indigo-200 underline disabled:opacity-40"
        >
          Undo day {undoableIndex + 1}
        </button>
      )}
    </div>
  );
}

/**
 * Formats an ISO date in UTC. Formatting in local time would shift the date by
 * a day for anyone west of Greenwich, since the backend stores midnight UTC.
 */
function formatUtcDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
  });
}

function StartDateLine({ rules }) {
  const formatted = formatUtcDate(rules?.startDateUtc);
  // Challenges created before start dates existed have none — show nothing
  // rather than a placeholder.
  if (!formatted) return null;

  return (
    <p className="mb-5 text-sm text-indigo-300/70 flex items-center gap-2">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      {rules?.notStartedYet ? `Starts ${formatted}` : `Started ${formatted}`}
    </p>
  );
}

function StatusLine({ rules }) {
  if (!rules) return null;

  if (rules.complete) {
    return (
      <p className="text-emerald-300 font-bold text-lg">
        All 100 days complete.
      </p>
    );
  }

  if (rules.canCheckNow) {
    return (
      <p className="text-indigo-200 text-center">
        {rules.isCatchUpDay
          ? `You missed a day — you can check ${rules.checksAllowedToday - rules.checksUsedToday} today to catch up.`
          : `Day ${(rules.nextIndex ?? 0) + 1} is ready. Click it to check in.`}
      </p>
    );
  }

  return (
    <p className="text-amber-200/80 text-center text-sm">
      {rules.blockedMessage ?? 'Come back tomorrow for the next day.'}
    </p>
  );
}
