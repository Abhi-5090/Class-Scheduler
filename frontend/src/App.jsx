import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AdminProvider, useAdmin } from './lib/useAdmin.js';

import Board from './pages/Board.jsx';
import Login from './pages/Login.jsx';
import Console from './admin/Console.jsx';

import Dashboard from './admin/Dashboard.jsx';
import BatchesTab from './admin/BatchesTab.jsx';
import TrainersTab from './admin/TrainersTab.jsx';
import VenuesTab from './admin/VenuesTab.jsx';
import GroupsTab from './admin/GroupsTab.jsx';
import PeriodsTab from './admin/PeriodsTab.jsx';
import SettingsTab from './admin/SettingsTab.jsx';
import AssistantBot from './components/AssistantBot.jsx';

function Gate({ children }) {
  const { admin, ready } = useAdmin();
  const location = useLocation();

  /* Hold the route until /auth/me answers, or a signed-in admin refreshing
     the page would be bounced to the login screen for a frame. */
  if (!ready) return <div className="login-shell"><div className="ldr" /></div>;
  if (!admin) return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  return children;
}

function Public() {
  const { admin } = useAdmin();
  return <Board admin={admin} />;
}

export default function App() {
  return (
    <AdminProvider>
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
      <AssistantBot />
    </AdminProvider>
  );
}
