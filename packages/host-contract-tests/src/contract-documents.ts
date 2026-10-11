import type { ProfileDocument } from '@comparer/core';

/**
 * The documents every adapter is seeded with before running the contract. Adapters may assign
 * their own ids, so the contract only relies on names, types, origins, and vendors.
 */
export const contractDocuments: readonly ProfileDocument[] = [
  {
    ref: { id: 'A/common', name: 'common', type: 'filament', origin: 'system', vendor: 'VendorA' },
    content: { name: 'common', nozzle_temperature: ['200'], instantiation: 'false' },
  },
  {
    ref: { id: 'A/PLA A', name: 'PLA A', type: 'filament', origin: 'system', vendor: 'VendorA' },
    content: {
      name: 'PLA A',
      inherits: 'common',
      nozzle_temperature: ['210'],
      instantiation: 'true',
      compatible_printers: ['Printer A 0.4 nozzle'],
    },
  },
  {
    // Same name as VendorA's base: resolveParent must prefer the child's own vendor.
    ref: { id: 'B/common', name: 'common', type: 'filament', origin: 'system', vendor: 'VendorB' },
    content: { name: 'common', nozzle_temperature: ['999'], instantiation: 'false' },
  },
  {
    ref: { id: 'A/0.20mm', name: '0.20mm', type: 'process', origin: 'system', vendor: 'VendorA' },
    content: { name: '0.20mm', layer_height: '0.2', instantiation: 'true' },
  },
  {
    ref: { id: 'user/My PLA', name: 'My PLA', type: 'filament', origin: 'user' },
    content: { name: 'My PLA', inherits: 'PLA A', from: 'User', nozzle_temperature: ['215'] },
  },
  {
    // A user root preset (inherits ""), which other user presets build on.
    ref: { id: 'user/My Base', name: 'My Base', type: 'filament', origin: 'user' },
    content: { name: 'My Base', inherits: '', from: 'User', nozzle_temperature: ['230'] },
  },
  {
    ref: { id: 'user/My Derived', name: 'My Derived', type: 'filament', origin: 'user' },
    content: { name: 'My Derived', inherits: 'My Base', from: 'User', fan_max_speed: ['50'] },
  },
];
