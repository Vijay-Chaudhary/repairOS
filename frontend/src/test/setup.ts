import '@testing-library/jest-dom';

// jsdom lacks ResizeObserver, which Radix UI (Switch/Select/etc.) relies on.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
