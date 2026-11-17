/**
 * The vocabulary of `Solid.kind` and `Rail.kind` strings the city generator uses, and what
 * `Solid.style` means for each. The renderer dresses meshes from this table; the sim ignores it.
 */

export interface KindInfo {
  /** Number of style values (styles are 0 .. styles - 1). */
  styles: number;
  /** What it is and what `style` selects. */
  note: string;
}

export const SOLID_KINDS = {
  building: { styles: 8, note: 'Mercado town house, flat roof. style = facade colour (0 ochre, 1 rose, 2 teal, 3 cream, 4 brick, 5 lime, 6 sky, 7 lilac)' },
  church: { styles: 1, note: 'The church behind the wedding plaza. style unused' },
  tower: { styles: 1, note: 'The clock tower on the plaza. style unused' },
  house: { styles: 8, note: 'Terrace house, flat roof. style = wall colour, same palette as building' },
  school: { styles: 1, note: 'The terrace school (its roof is a landmark). style unused' },
  warehouse: { styles: 4, note: 'Docks warehouse. style = cladding (0 rust, 1 green, 2 grey, 3 blue)' },
  market: { styles: 1, note: 'The fish market hall, low roof. style unused' },
  container: { styles: 6, note: 'Shipping container stack (one solid per stack, 2.6 m per level). style = colour (0 red, 1 blue, 2 green, 3 orange, 4 white, 5 yellow)' },
  crate: { styles: 3, note: 'Wooden crate or pallet stack. style = wood tone' },
  awning: { styles: 6, note: 'One-way, bouncy market awning 0.2 m thick. style = stripe colour' },
  stall: { styles: 6, note: 'Market stall with a 2.4 m roof. style = canopy colour' },
  kiosk: { styles: 2, note: 'Small kiosk or fountain block. style 0 kiosk, 1 fountain' },
  wall: { styles: 2, note: 'Retaining wall or parapet; top flush with the higher ground. style 0 stone, 1 concrete' },
  quay: { styles: 1, note: 'The low quay wall along the sea. style unused' },
  platform: { styles: 3, note: 'Flat deck: style 0 ferry pier, 1 hill station, 2 ghost-tram tunnel lid' },
  shed: { styles: 3, note: 'Hill shed or shack. style 0 shed, 1 radio shack, 2 hut' },
  dish: { styles: 2, note: 'Satellite dish on a plinth (box is the plinth + dish bounds). style = size' },
  mast: { styles: 2, note: 'Thin tall lattice mast. style 0 radio mast, 1 the summit needle mast' },
  needle: { styles: 1, note: 'The 4 x 4 m platform on top of the summit antenna (secret). style unused' },
  pylon: { styles: 1, note: 'Cable-car pylon between the two cables. style unused' },
} as const satisfies Record<string, KindInfo>;

export const RAIL_KINDS = {
  handrail: { styles: 1, note: 'Stair handrail, 0.9 m above the steps, 4 m level run-in at the top, short run-out at the bottom' },
  ledge: { styles: 1, note: 'Edge of a wall, quay, pier or container top' },
  wire: { styles: 1, note: 'Laundry line across a terrace street, 3-5 m up' },
  pipe: { styles: 1, note: 'Docks pipe along a warehouse wall, or the gantry crane rail' },
  guy: { styles: 1, note: 'Guy wire from a mast top down to a ground anchor' },
} as const satisfies Record<string, KindInfo>;

export type SolidKind = keyof typeof SOLID_KINDS;
export type RailKind = keyof typeof RAIL_KINDS;
