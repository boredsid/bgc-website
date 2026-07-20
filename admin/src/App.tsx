import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import EventsList from './pages/EventsList';
import EventDrawer from './pages/EventDrawer';
import GamesList from './pages/GamesList';
import GameDrawer from './pages/GameDrawer';
import RegistrationsList from './pages/RegistrationsList';
import RegistrationDrawer from './pages/RegistrationDrawer';
import ManualRegistrationDrawer from './pages/ManualRegistrationDrawer';
import GuildList from './pages/GuildList';
import GuildDrawer from './pages/GuildDrawer';
import UsersList from './pages/UsersList';
import UserDrawer from './pages/UserDrawer';
import Leads from './pages/Leads';
import Giveaways from './pages/Giveaways';
import Corporate from './pages/Corporate';
import GuestApp from './GuestApp';
import { WhoAmIProvider } from './lib/whoami';
import { Toaster } from '@/components/ui/sonner';

function AdminRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/events" element={<EventsList />} />
        <Route path="/events/new" element={<><EventsList /><EventDrawer mode="create" /></>} />
        <Route path="/events/:id" element={<><EventsList /><EventDrawer mode="edit" /></>} />
        <Route path="/games" element={<GamesList />} />
        <Route path="/games/new" element={<><GamesList /><GameDrawer mode="create" /></>} />
        <Route path="/games/:id" element={<><GamesList /><GameDrawer mode="edit" /></>} />
        <Route path="/registrations" element={<RegistrationsList />} />
        <Route path="/registrations/new" element={<><RegistrationsList /><ManualRegistrationDrawer /></>} />
        <Route path="/registrations/:id" element={<><RegistrationsList /><RegistrationDrawer /></>} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/giveaways" element={<Giveaways />} />
        <Route path="/corporate" element={<Corporate />} />
        <Route path="/guild" element={<GuildList />} />
        <Route path="/guild/:id" element={<><GuildList /><GuildDrawer /></>} />
        <Route path="/guild/:id/user" element={<><GuildList /><GuildDrawer /><UserDrawer /></>} />
        <Route path="/users" element={<UsersList />} />
        <Route path="/users/:id" element={<><UsersList /><UserDrawer /></>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <>
      <WhoAmIProvider fallback={<div className="p-8">Loading…</div>}>
        {(who) => (who.role === 'guest' ? <GuestApp /> : <AdminRoutes />)}
      </WhoAmIProvider>
      <Toaster />
    </>
  );
}
