// Frontend wrapper re-exporting actual app from src/frontend
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import BedtimeApp from './BedtimeApp';

const App: React.FC = () => {
  return (
    <Router>
      <div>
        <nav>
          <ul>
            <li>
              <Link to="/">Home</Link>
            </li>
            <li>
              <Link to="/stories">Stories</Link>
            </li>
          </ul>
        </nav>

        <Routes>
          <Route path="/" element={<BedtimeApp />} />

        </Routes>
      </div>
    </Router>
  );
};

export default App;
