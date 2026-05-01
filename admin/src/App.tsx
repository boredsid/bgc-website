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
          <Route path="/games/new" element={<><GamesList /><GameDrawer mode="create" /></>} />
          <Route path="/games/:id" element={<><GamesList /><GameDrawer mode="edit" /></>} />
          <Route path="/registrations" element={<RegistrationsList />} />
          <Route path="/registrations/new" element={<><RegistrationsList /><ManualRegistrationDrawer /></>} />
          <Route path="/registrations/:id" element={<><RegistrationsList /><RegistrationDrawer /></>} />
          <Route path="/guild" element={<GuildList />} />
          <Route path="/guild/:id" element={<GuildList />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster />
    </>
  );
}
