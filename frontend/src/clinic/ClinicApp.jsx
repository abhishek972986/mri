/**
 * The authenticated clinical application: every route under /app.
 *
 * Code-split from the landing page (three.js, the viewers and every page
 * here load only once a doctor signs in). The whole tree sits behind
 * RequireAuth; the API enforces the same thing server-side on every request.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './AppShell';
import { RequireAuth } from './auth';
import './clinic.css';
import ComparePage from './pages/ComparePage';
import DashboardPage from './pages/DashboardPage';
import { ReportsPage, ScansPage, UploadPickerPage, VisualizationIndexPage } from './pages/ListPages';
import NewScanPage from './pages/NewScanPage';
import PatientFormPage from './pages/PatientFormPage';
import PatientProfilePage from './pages/PatientProfilePage';
import PatientsPage from './pages/PatientsPage';
import ProfilePage from './pages/ProfilePage';
import ReportPage from './pages/ReportPage';
import ScanPage from './pages/ScanPage';
import VisualizationPage from './pages/VisualizationPage';

export default function ClinicApp() {
  return (
    <RequireAuth>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="patients" element={<PatientsPage />} />
          <Route path="patients/new" element={<PatientFormPage />} />
          <Route path="patients/:patientId" element={<PatientProfilePage />} />
          <Route path="patients/:patientId/edit" element={<PatientFormPage />} />
          <Route path="patients/:patientId/new-scan" element={<NewScanPage />} />
          <Route path="patients/:patientId/compare" element={<ComparePage />} />
          <Route path="scans" element={<ScansPage />} />
          <Route path="scans/upload" element={<UploadPickerPage />} />
          <Route path="scans/:scanId" element={<ScanPage />} />
          <Route path="scans/:scanId/visualization" element={<VisualizationPage />} />
          <Route path="scans/:scanId/report" element={<ReportPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="visualization" element={<VisualizationIndexPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Route>
      </Routes>
    </RequireAuth>
  );
}
