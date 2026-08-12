import { useState, useEffect } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';

export default function Home({ token, setToken, logout }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [myChallenges, setMyChallenges] = useState([]);
  const [error, setError] = useState(null);
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

  const handleCreate = async () => {
    if (!name.trim() || !token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/Challenges', {
        token,
        method: 'POST',
        body: { name },
      });
      if (data && data.id) navigate(`/${data.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      setError(describe(err));
    } finally {
      setLoading(false);
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
          <button
            onClick={handleCreate}
            disabled={loading || !name.trim()}
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
              <button 
                key={c.id} 
                onClick={() => navigate(`/${c.id}`)}
                className="w-full p-8 bg-indigo-900/40 hover:bg-indigo-800/80 rounded-2xl text-center border border-indigo-500/30 transition-all hover:-translate-y-2 font-bold shadow-lg shadow-indigo-900/20 text-2xl truncate"
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function describe(err) {
  if (err instanceof ApiError) {
    if (!err.status) return 'The request never reached the server (network/proxy failure).';
    if (err.status === 503) return 'The API proxy is up but the backend or its database is not responding.';
    return `Server responded ${err.status}.`;
  }
  return String(err?.message ?? err);
}
