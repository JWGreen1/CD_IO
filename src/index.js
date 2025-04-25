import React from 'react';
import ReactDOM from 'react-dom/client';
// import './index.css'; // Keep or remove based on your choice for index.css
import App from './App';
// import reportWebVitals from './reportWebVitals'; // <--- DELETE THIS LINE

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
// reportWebVitals(); // <--- DELETE THIS LINE