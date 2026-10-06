# Graphical Verilog

A browser app for designing digital circuits as block diagrams and state machines. It simulates them cycle by cycle and exports synthesizable Verilog-2001.

## Run it

Open `dist/graphical-verilog.html` in Chrome, Edge, Firefox or Safari. It needs no install, server or internet connection. Your work autosaves in that browser. Use **File → Save project file** to keep a `.gv.json` copy.

To rebuild after editing `src/`: `node build.js`.

## What's in it

**Circuit editor**
- Blocks: inputs, outputs, constants, probes, AND/OR/XOR/NAND/NOR/XNOR/NOT (2–16 inputs, any bus width), multiplexers, decoders, bit slice, concatenate, zero/sign extend, an operator block (`+ - * / % & | ^ << >> == != < <= > >=`), full adder, registers (optional enable), and counters (step, up/down, clear).
- **Expression blocks**: declare any ports and write Verilog expressions (`y = a + b; eq = a == b`). Select one and press *Save to library* to turn it into a reusable block of your own.
- **Subcircuits**: every circuit can be dropped into another as a block. Double-click a block to open it.
- **State machines**: drop any FSM into a circuit as a block.
- Wires are drawn pin to pin. A width mismatch shows as a dashed wire.
- Editing: undo/redo, copy/paste, box select, zoom/pan, fit to window.

**State machine editor**
- Double-click to add a state. Shift-drag from one state to another to add a transition.
- Conditions are Verilog expressions. When several transitions leave a state they are checked in priority order, which you can change.
- Moore outputs go on states and Mealy actions on transitions. Outputs can have default values.
- Binary, Gray or one-hot encoding. You can optionally add the state as an output port.

**Simulation**
- Press **Simulate**, click inputs to change them, then use **Step** (Space), **Run** or **Reset** (R).
- Wires light up with their values, and a waveform panel records every cycle.
- State machines can also be simulated on their own, with the active state and transition highlighted.
- **File → Export testbench** turns the recorded cycles into a self-checking Verilog testbench, so you can confirm the generated Verilog behaves the same in a real simulator:
  `iverilog -o sim design.v tb_main.v && vvp sim`

**Customization (Settings ⚙)**
- Light, dark or system theme, and an accent colour.
- ANSI or IEC gate symbols.
- Right-angle, curved or straight wires.
- Grid and snapping, bus-width labels, value radix, run speed.
- A colour for each block category, plus a colour for each individual block or wire.
- Verilog output: clock and reset names, synchronous or asynchronous reset, active-low reset, indentation and header comments.

All registers and FSMs share one implicit clock and reset. These are added as ports to every module that needs them.

## Tests

`node test/run.js` runs the engine tests. With Icarus Verilog installed, it checks 400 random expressions and three full designs (every block type, all reset styles) against `iverilog`.

`test/ui.js` and `test/ui2.js` are Playwright browser tests.

## Layout

`src/expr.js` (expression parser and evaluator), `model.js` (block registry), `sim.js` (simulator), `verilog.js` (code and testbench generation), `examples.js`, `app.js` (shell, settings, files), `ui-circuit.js`, `ui-fsm.js`, `ui-wave.js` (waveform and Verilog views), `style.css`, `index.html`. `build.js` inlines everything into one HTML file.
