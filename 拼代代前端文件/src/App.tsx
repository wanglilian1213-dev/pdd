/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import DashboardLayout from './components/layout/DashboardLayout';
import Workspace from './pages/dashboard/Workspace';
import Tasks from './pages/dashboard/Tasks';
import Recharge from './pages/dashboard/Recharge';
import ActivationRules from './pages/ActivationRules';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/activation-rules" element={<ActivationRules />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/terms-of-service" element={<TermsOfService />} />
        
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<Navigate to="/dashboard/workspace" replace />} />
          <Route path="workspace" element={<Workspace />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="recharge" element={<Recharge />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
