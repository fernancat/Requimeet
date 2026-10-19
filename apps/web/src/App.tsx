import ReviewPage from './pages/ReviewPage';
import { Navigate, Route, Routes } from 'react-router-dom';
import { getHostToken } from './lib/auth';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import MeetingEntryPage from './pages/MeetingEntryPage';
import RegisterPage from './pages/RegisterPage';

function RequireHost({ children }: { children: JSX.Element }) {
  if (!getHostToken()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={<Navigate to={getHostToken() ? '/dashboard' : '/login'} replace />}
      />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/dashboard"
        element={
          <RequireHost>
            <DashboardPage />
          </RequireHost>
        }
      />
      <Route path="/meetings/:code/review" element={<RequireHost><ReviewPage /></RequireHost>} />
      <Route path="/m/:code" element={<MeetingEntryPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
