import { Routes, Route, Navigate } from 'react-router-dom';
import GuestLayout from './components/GuestLayout';
import RegistrationsList from './pages/RegistrationsList';
import RegistrationDrawer from './pages/RegistrationDrawer';
import ManualRegistrationDrawer from './pages/ManualRegistrationDrawer';

export default function GuestApp() {
  return (
    <Routes>
      <Route element={<GuestLayout />}>
        <Route path="/registrations" element={<RegistrationsList />} />
        <Route path="/registrations/new" element={<><RegistrationsList /><ManualRegistrationDrawer /></>} />
        <Route path="/registrations/:id" element={<><RegistrationsList /><RegistrationDrawer /></>} />
        <Route path="*" element={<Navigate to="/registrations" replace />} />
      </Route>
    </Routes>
  );
}
