import { useState, useEffect } from 'react';

export function useAuth() {
  const [token, setTokenState] = useState(() => {
    const savedToken = localStorage.getItem('token');
    return savedToken && savedToken !== 'null' && savedToken !== 'undefined' ? savedToken : null;
  });

  const setToken = (newToken) => {
    if (newToken && newToken !== 'null' && newToken !== 'undefined') {
      localStorage.setItem('token', newToken);
      setTokenState(newToken);
    } else {
      localStorage.removeItem('token');
      setTokenState(null);
    }
  };

  const logout = () => {
    setToken(null);
  };

  return { token, setToken, logout };
}
