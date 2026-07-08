#!/usr/bin/env node
/**
 * Demo entry point for Kairos TUI
 * Run with: node --loader tsx demo.tsx
 * Or: tsx demo.tsx
 */

import React from 'react';
import { render } from 'ink';
import { App } from './App.js';

// Demo: render the TUI with sample data
const instance = render(
  <App
    provider="anthropic"
    model="claude-sonnet-4-6"
    budgetTotal={10.0}
    budgetRemaining={8.5}
    securityProfile="standard"
    onCommand={(cmd) => {
      console.log('Command received:', cmd);
    }}
  />
);

// Wait for user to quit
await instance.waitUntilExit();
