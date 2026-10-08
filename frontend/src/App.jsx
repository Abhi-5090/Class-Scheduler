import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AdminProvider, useAdmin, homeFor } from './lib/useAdmin.js';
import { FeedbackProvider } from './lib/feedback.jsx';

import Board from './pages/Board.jsx';

/* Everything a public visitor never needs loads on demand: the console and its
   pages only once someone signs in, the assistant only once the board is up. */
const Login = lazy(() => import('./pages/Login.jsx'));
const Console = lazy(() => import('./admin/Console.jsx'));
const Dashboard = lazy(() => import('./admin/Dashboard.jsx'));
const Workload = lazy(() => import('./admin/Workload.jsx'));
const Finder = lazy(() => import('./admin/Finder.jsx'));
const MySchedule = lazy(() => import('./admin/MySchedule.jsx'));
const BatchesTab = lazy(() => import('./admin/BatchesTab.jsx'));
const Exceptions = lazy(() => import('./admin/Exceptions.jsx'));
const TrainersTab = lazy(() => import('./admin/TrainersTab.jsx'));
const VenuesTab = lazy(() => import('./admin/VenuesTab.jsx'));
const GroupsTab = lazy(() => import('./admin/GroupsTab.jsx'));
const DataTab = lazy(() => import('./admin/DataTab.jsx'));
const Notifications = lazy(() => import('./admin/Notifications.jsx'));
const PeriodsTab = lazy(() => import('./admin/PeriodsTab.jsx'));
const UsersTab = lazy(() => import('./admin/UsersTab.jsx'));
const History = lazy(() => import('./admin/History.jsx'));
const SettingsTab = lazy(() => import('./admin/SettingsTab.jsx'));
const AssistantBot = lazy(() => import('./components/AssistantBot.jsx'));

const Waiting = () => <div className="login-shell"><div className="ldr" role="status" aria-label="Loading" /></div>;

const STAFF = ['admin', 'coordinator'];

/* Signed in at all. An account still on a temporary password is held on
   Settings until it sets its own — the server refuses everything else anyway. */
function Gate({ children }) {
  const { user, ready } = useAdmin();
  const location = useLocation();
  if (!ready) return <Waiting />;
  if (!user) return <Navigate to="/admin/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.mustChangePassword && location.pathname !== '/admin/settings') return <Navigate to="/admin/settings" replace />;
  return children;
}

/* Only these roles; anyone else lands on their own home page. */
function Only({ roles, children }) {
  const { user } = useAdmin();
  if (!roles.includes(user?.role)) return <Navigate to={homeFor(user)} replace />;
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
  const only = (roles, el) => <Only roles={roles}>{el}</Only>;
  return (
    <FeedbackProvider>
      <AdminProvider>
        <Suspense fallback={<Waiting />}>
          <Routes>
            <Route path="/" element={<Public />} />
            <Route path="/admin/login" element={<Login />} />
            <Route path="/admin" element={<Gate><Console /></Gate>}>
              <Route index element={only(STAFF, <Dashboard />)} />
              <Route path="me" element={<MySchedule />} />
              <Route path="workload" element={only(STAFF, <Workload />)} />
              <Route path="finder" element={<Finder />} />
              <Route path="batches" element={only(STAFF, <BatchesTab />)} />
              <Route path="exceptions" element={only(STAFF, <Exceptions />)} />
              <Route path="trainers" element={only(['admin'], <TrainersTab />)} />
              <Route path="venues" element={only(['admin'], <VenuesTab />)} />
              <Route path="groups" element={only(['admin'], <GroupsTab />)} />
              <Route path="data" element={only(STAFF, <DataTab />)} />
              <Route path="notifications" element={only(STAFF, <Notifications />)} />
              <Route path="periods" element={only(['admin'], <PeriodsTab />)} />
              <Route path="users" element={only(['admin'], <UsersTab />)} />
              <Route path="history" element={only(['admin'], <History />)} />
              <Route path="settings" element={<SettingsTab />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AdminProvider>
    </FeedbackProvider>
  );
}
