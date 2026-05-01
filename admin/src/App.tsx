import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import EventsList from './pages/EventsList';
import EventDrawer from './pages/EventDrawer';
import GamesList from './pages/GamesList';
import RegistrationsList from './pages/RegistrationsList';
import GuildList from './pages/GuildList';
import { Toaster } from '@/components/ui/sonner';

export default function App() {
  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/events" element={<EventsList />} />
          <Route path="/events/new" element={<><EventsList /><EventDrawer mode="create" /></>} />
          <Route path="/events/:id" element={<><EventsList /><EventDrawer mode="edit" /></>} />
          <Route path="/games" element={<GamesList />} />
          <Route path="/games/new" element={<GamesList />} />
          <Route path="/games/:id" element={<GamesList />} />
          <Route path="/registrations" element={<RegistrationsList />} />
          <Route path="/registrations/new" element={<RegistrationsList />} />
          <Route path="/registrations/:id" element={<RegistrationsList />} />
          <Route path="/guild" element={<GuildList />} />
          <Route path="/guild/:id" element={<GuildList />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster />
    </>
  );
}
