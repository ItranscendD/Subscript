import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

app.use(express.json());

// Enable basic CORS for debugging
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const defaultCards = [
  { id: 'c1', name: 'Personal Card', digits: '•••• •••• •••• 8899', expiry: '09/29', limit: 50.00, scope: 'personal' },
  { id: 'c2', name: 'Team SaaS Card', digits: '•••• •••• •••• 4321', expiry: '12/28', limit: 150.00, scope: 'team' }
];

const getDefaultState = () => ({
  subscriptions: [],
  notifications: [],
  dismissedRedundancies: [],
  virtualCards: defaultCards,
  connectedEmails: [],
  teammates: [
    { id: 't1', name: 'You', email: '', role: 'Owner', status: 'active' }
  ],
  googleClientId: '',
  onboardingCompleted: false,
  userName: 'You',
  userEmail: '',
  lastNotifCheck: '',
  layoutMode: 'desktop'
});

// Read state
const readState = () => {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading db.json, returning default state:', err);
  }
  
  // Seed database with defaults if it doesn't exist or is invalid
  const defaultState = getDefaultState();
  writeState(defaultState);
  return defaultState;
};

// Write state
const writeState = (state) => {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing to db.json:', err);
    return false;
  }
};

// Endpoints
app.get('/api/state', (req, res) => {
  res.json(readState());
});

app.post('/api/state', (req, res) => {
  const newState = req.body;
  if (!newState) {
    return res.status(400).json({ error: 'No state payload provided' });
  }
  const success = writeState(newState);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: 'Failed to save state to server' });
  }
});

app.post('/api/reset', (req, res) => {
  const defaultState = getDefaultState();
  const success = writeState(defaultState);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: 'Failed to reset state' });
  }
});

app.listen(PORT, () => {
  console.log(`Subscript Backend Server running on http://localhost:${PORT}`);
});
