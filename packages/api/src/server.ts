import { startServer } from './app';

if (process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
