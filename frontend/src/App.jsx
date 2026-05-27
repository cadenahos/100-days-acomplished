import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './components/Home';
import ChallengeView from './components/ChallengeView';
import { useAuth } from './hooks/useAuth';

function App() {
  const { token, setToken, logout } = useAuth();

  return (
    <BrowserRouter>
      <div className="w-full flex justify-center items-center min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-4">
        <Routes>
          <Route path="/" element={<Home token={token} setToken={setToken} logout={logout} />} />
          <Route path="/:challengeId" element={token ? <ChallengeView token={token} logout={logout} /> : <Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
