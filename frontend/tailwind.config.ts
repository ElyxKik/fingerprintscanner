import type { Config } from 'tailwindcss';
const config: Config = { content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'], theme: { extend: { colors: { ink: '#111318', blue: '#2563EB', mist: '#F5F7FA' }, boxShadow: { soft: '0 20px 60px rgba(15,23,42,.08)' } } }, plugins: [] };
export default config;
