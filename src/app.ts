import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { errorHandler } from './middleware/errors.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { billRoutes } from './modules/bills/bills.routes.js';
import { expenseRoutes } from './modules/expenses/expenses.routes.js';
import { installmentRoutes } from './modules/installments/installments.routes.js';
import { paymentRoutes } from './modules/payments/payments.routes.js';
import { projectRoutes } from './modules/projects/projects.routes.js';
import { supplierRoutes } from './modules/suppliers/suppliers.routes.js';
import { inviteRoutes, teamRoutes } from './modules/team/team.routes.js';

export const app = express();

app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use('/auth', authRoutes);
app.use('/projects', projectRoutes);
app.use('/suppliers', supplierRoutes);
app.use('/payments', paymentRoutes);
app.use('/expenses', expenseRoutes);
app.use('/bills', billRoutes);
app.use('/installments', installmentRoutes);
app.use('/team', teamRoutes);
app.use('/invites', inviteRoutes);
app.use('/audit', auditRoutes);

app.use(errorHandler); // must be last
