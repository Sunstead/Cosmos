import './App.css';
import { ThemeProvider } from './components/theme-provider';
import { ThemeToggle } from './components/theme-toggle';
import { Button } from './components/ui/button';

function App() {
  return (
    <ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
      <main className='container'>
        <h1>Welcome to Tauri + React</h1>
        <ThemeToggle />

        <Button>Test button</Button>
      </main>
    </ThemeProvider>
  );
}

export default App;
