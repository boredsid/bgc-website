import { Routes, Route, Navigate } from 'react-router-dom';
import GuestLayout from './components/GuestLayout';
import Dashboard from './pages/Dashboard';
import RegistrationsList from './pages/RegistrationsList';
import RegistrationDrawer from './pages/RegistrationDrawer';
import ManualRegistrationDrawer from './pages/ManualRegistrationDrawer';
import Leads from './pages/Leads';

export default function GuestApp() {
  return (
    <Routes>
      <Route element={<GuestLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/registrations" element={<RegistrationsList />} />
        <Route path="/registrations/new" element={<><RegistrationsList /><ManualRegistrationDrawer /></>} />
        <Route path="/registrations/:id" element={<><RegistrationsList /><RegistrationDrawer /></>} />
        <Route path="/leads" element={<Leads />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
