import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AdminProvider, useAdmin } from './lib/useAdmin.js';
import { FeedbackProvider } from './lib/feedback.jsx';

import Board from './pages/Board.jsx';

/* Everything a public visitor never needs loads on demand: the console and its
   tabs only once someone signs in, the assistant only once the board is up. */
const Login = lazy(() => import('./pages/Login.jsx'));
const Console = lazy(() => import('./admin/Console.jsx'));
const Dashboard = lazy(() => import('./admin/Dashboard.jsx'));
const BatchesTab = lazy(() => import('./admin/BatchesTab.jsx'));
const TrainersTab = lazy(() => import('./admin/TrainersTab.jsx'));
const VenuesTab = lazy(() => import('./admin/VenuesTab.jsx'));
const GroupsTab = lazy(() => import('./admin/GroupsTab.jsx'));
const PeriodsTab = lazy(() => import('./admin/PeriodsTab.jsx'));
const SettingsTab = lazy(() => import('./admin/SettingsTab.jsx'));
const AssistantBot = lazy(() => import('./components/AssistantBot.jsx'));

const Waiting = () => <div className="login-shell"><div className="ldr" role="status" aria-label="Loading" /></div>;

function Gate({ children }) {
  const { admin, ready } = useAdmin();
  const location = useLocation();

  /* Hold the route until /auth/me answers, or a signed-in admin refreshing
     the page would be bounced to the login screen for a frame. */
  if (!ready) return <Waiting />;
  if (!admin) return <Navigate to="/admin/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

function Public() {
  const { admin } = useAdmin();
  return (
    <>
      <Board admin={admin} />
      {/* the assistant answers questions about the public board, so it lives
          there and stays out of the way of the console's tables */}
      <Suspense fallback={null}><AssistantBot /></Suspense>
    </>
  );
}

export default function App() {
  return (
    <FeedbackProvider>
      <AdminProvider>
        <Suspense fallback={<Waiting />}>
          <Routes>
            <Route path="/" element={<Public />} />
            <Route path="/admin/login" element={<Login />} />
            <Route path="/admin" element={<Gate><Console /></Gate>}>
              <Route index element={<Dashboard />} />
              <Route path="batches" element={<BatchesTab />} />
              <Route path="trainers" element={<TrainersTab />} />
              <Route path="venues" element={<VenuesTab />} />
              <Route path="groups" element={<GroupsTab />} />
              <Route path="periods" element={<PeriodsTab />} />
              <Route path="settings" element={<SettingsTab />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AdminProvider>
    </FeedbackProvider>
  );
}
