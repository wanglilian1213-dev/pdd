/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import DashboardLayout from './components/layout/DashboardLayout';
import { BalanceProvider } from './contexts/BalanceContext';
import Workspace from './pages/dashboard/Workspace';
import Tasks from './pages/dashboard/Tasks';
import Recharge from './pages/dashboard/Recharge';
import ActivationRules from './pages/ActivationRules';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, authBusy } = useAuth();
  if (loading || authBusy) return <div className="flex items-center justify-center h-screen text-gray-500">加载中...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, authBusy } = useAuth();
  if (loading || authBusy) return <div className="flex items-center justify-center h-screen text-gray-500">加载中...</div>;
  if (user) return <Navigate to="/dashboard/workspace" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
        <Route path="/register" element={<PublicOnlyRoute><Register /></PublicOnlyRoute>} />
        <Route path="/activation-rules" element={<ActivationRules />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/terms-of-service" element={<TermsOfService />} />

        <Route path="/dashboard" element={<ProtectedRoute><BalanceProvider><DashboardLayout /></BalanceProvider></ProtectedRoute>}>
          <Route index element={<Navigate to="/dashboard/workspace" replace />} />
          <Route path="workspace" element={<Workspace />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="recharge" element={<Recharge />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
