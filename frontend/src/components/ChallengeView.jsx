import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';

export default function ChallengeView({ token, logout }) {
  const { challengeId } = useParams();
  const navigate = useNavigate();
  const [challenge, setChallenge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    apiFetch(`/Challenges/${challengeId}`, { token })
      .then(data => {
        if (cancelled) return;
        setChallenge(data);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          logout();
          return;
        }
        setError(err instanceof ApiError && err.status === 404
          ? 'Challenge not found.'
          : 'Could not load this challenge — the API is unreachable. Run __apiDiagnostics() in the console.');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [challengeId, token, logout]);

  const toggleCheckbox = async (index) => {
    if (!challenge) return;

    const chars = challenge.checkboxesState.split('');
    chars[index] = chars[index] === '1' ? '0' : '1';
    const newState = chars.join('');

    const previous = challenge.checkboxesState;
    // Optimistic update
    setChallenge({ ...challenge, checkboxesState: newState });

    try {
      await apiFetch(`/Challenges/${challengeId}`, {
        token,
        method: 'PUT',
        body: { checkboxesState: newState },
      });
      setError(null);
    } catch (err) {
      // Roll back so the UI never silently lies about saved state.
      setChallenge(c => (c ? { ...c, checkboxesState: previous } : c));
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      setError('Change was not saved — the API rejected or never received it.');
    }
  };

  if (loading) {
    return <div className="text-2xl animate-pulse text-indigo-300">Loading...</div>;
  }

  if (!challenge) {
    return <div className="text-red-400">{error ?? 'Challenge not found.'}</div>;
  }

  const checkboxes = challenge.checkboxesState.split('');

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
      
      <h2 className="text-5xl font-black mb-12 mt-8 md:mt-0 text-center bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-indigo-400 tracking-tight">
        {challenge.name}
      </h2>
      
      <div className="grid grid-cols-10 gap-3 sm:gap-4 md:gap-5">
        {checkboxes.map((state, index) => {
          const isChecked = state === '1';
          return (
            <div
              key={index}
              onClick={() => toggleCheckbox(index)}
              className={`
                relative flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 
                rounded-xl cursor-pointer transition-all duration-300 transform hover:scale-110 
                ${isChecked 
                  ? 'bg-gradient-to-br from-green-400 to-emerald-600 shadow-[0_0_15px_rgba(52,211,153,0.5)] border-transparent' 
                  : 'bg-white/10 hover:bg-white/20 border border-white/20'
                }
              `}
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
      
      {error && (
        <div className="mt-8 w-full max-w-2xl rounded-2xl border border-red-500/40 bg-red-950/50 px-6 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="mt-12 text-lg font-medium text-indigo-200">
        Progress: <span className="text-white font-bold">{checkboxes.filter(c => c === '1').length}</span> / 100 Days
      </div>
    </div>
  );
}
