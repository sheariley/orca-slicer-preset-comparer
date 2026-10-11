import { describe, expect, it } from 'vitest';
import {
  parseConstants,
  parseEnumKeys,
  parsePresetOptionLists,
  parsePrintConfig,
  parseVariantKeys,
} from './parse-print-config.ts';

const SOURCE = `
static t_config_enum_values s_keys_map_InfillPattern {
    { "crosshatch", ipCrossHatch },
};
static t_config_enum_values s_keys_map_PrintOrder {
    { "default", int(PrintOrder::Default) },
};
static t_config_enum_values s_keys_map_SurfaceFillOrder {
    { "inner_outer", int(SurfaceFillOrder::Default) },
};

const std::vector<std::string> filament_extruder_override_keys = {
    // floats
    "filament_retraction_length",
};

    def = this->add("filament_max_volumetric_speed", coFloats);
    def->label = L("Max volumetric speed");
    def->tooltip = L("This setting is the volume of filament; it can be melted. "
                     "This value cannot be zero.");
    def->sidetext = L(u8"mm³/s");	// cubic millimeters per second
    def->min = 0;
    def->set_default_value(new ConfigOptionFloats { 2. });

    auto def_top_fill_pattern = def = this->add("top_surface_pattern", coEnum);
    def->label = L("Top surface pattern");
    def->enum_values.push_back("concentric");
    def->enum_values.emplace_back("zig-zag");
    def->enum_labels.push_back(L("Concentric"));
    def->enum_labels.emplace_back(L("Zig Zag"));
    // def->enum_labels.push_back(L("Retired"));

    def = this->add("bottom_surface_pattern", coEnum);
    def->label = L("Bottom surface pattern");
    def->enum_values = def_top_fill_pattern->enum_values;
    def->enum_labels = def_top_fill_pattern->enum_labels;

    def = this->add("hot_plate_temp", coInts);
    def->label = L("Other layers");
    def->sidetext = L(u8"\\u2103" /* °C */);	// degrees Celsius
    def->full_label = L("Bed temperature");
    def->category = L("Temperature");
    def->set_default_value(new ConfigOptionInts{ 45 }); // per extruder

    def = this->add("sparse_infill_pattern", coEnum);
    def->set_default_value(new ConfigOptionEnum<InfillPattern>(ipCrossHatch));

    def = this->add("print_order", coEnum);
    def->set_default_value(new ConfigOptionEnum<PrintOrder>(PrintOrder::Default));

    def = this->add("retraction_length", coFloats);
    def->label = L("Length");
    def->set_default_value(new ConfigOptionFloats { 0.8 });

    def = this->add("machine_load_filament_time", coFloat);
    def->sidetext = L_CONTEXT("s", "second");
    def->set_default_value(new ConfigOptionFloat(compute_time()));

    def = this->add(opt_key, coFloat);
    def->label = L("Computed key, skipped");
`;

const context = { enumKeys: parseEnumKeys(SOURCE), constants: new Map<string, string>() };

describe('parsePrintConfig', () => {
  const { settings, skippedDefaults } = parsePrintConfig(SOURCE, context);

  it('reads labels, units, concatenated tooltips, and defaults', () => {
    expect(settings.get('filament_max_volumetric_speed')).toEqual({
      label: 'Max volumetric speed',
      tooltip:
        'This setting is the volume of filament; it can be melted. This value cannot be zero.',
      unit: 'mm³/s',
      default: ['2'],
    });
  });

  it('decodes escapes, ignores comments, and reads full labels and categories', () => {
    expect(settings.get('hot_plate_temp')).toEqual({
      label: 'Other layers',
      fullLabel: 'Bed temperature',
      category: 'Temperature',
      unit: '℃',
      default: ['45'],
    });
  });

  it('resolves enum defaults, including scoped constants', () => {
    expect(settings.get('sparse_infill_pattern')?.default).toBe('crosshatch');
    expect(settings.get('print_order')?.default).toBe('default');
  });

  it("reads an option's enum values and labels, and copies another option's", () => {
    expect(settings.get('top_surface_pattern')).toMatchObject({
      enumValues: ['concentric', 'zig-zag'],
      enumLabels: ['Concentric', 'Zig Zag'],
    });
    expect(settings.get('bottom_surface_pattern')).toMatchObject({
      enumValues: ['concentric', 'zig-zag'],
      enumLabels: ['Concentric', 'Zig Zag'],
    });
  });

  it('copies printer settings into their filament overrides', () => {
    expect(settings.get('filament_retraction_length')).toEqual({
      label: 'Length',
      default: ['0.8'],
    });
  });

  it('takes the text, not the context, from L_CONTEXT', () => {
    expect(settings.get('machine_load_filament_time')?.unit).toBe('s');
  });

  it('reports defaults it cannot parse instead of guessing', () => {
    expect(settings.get('machine_load_filament_time')?.default).toBeUndefined();
    expect(skippedDefaults.map((skipped) => skipped.key)).toEqual(['machine_load_filament_time']);
  });

  it('skips options with computed keys', () => {
    expect(settings.has('opt_key')).toBe(false);
    expect(settings.size).toBe(9);
  });
});

describe('parseEnumKeys', () => {
  it('keys constants qualified, and bare only when unambiguous', () => {
    const keys = parseEnumKeys(SOURCE);

    expect(keys.get('ipCrossHatch')).toBe('crosshatch');
    expect(keys.get('PrintOrder::Default')).toBe('default');
    expect(keys.get('SurfaceFillOrder::Default')).toBe('inner_outer');
    expect(keys.has('Default')).toBe(false);
  });
});

describe('parseConstants', () => {
  it('reads numeric and boolean #defines', () => {
    const constants = parseConstants(
      '#define INITIAL_LAYER_HEIGHT 0.2\n#define INITIAL_REDUCE_CROSSING_WALL false\n#define NAME "x"\n',
    );

    expect([...constants]).toEqual([
      ['INITIAL_LAYER_HEIGHT', '0.2'],
      ['INITIAL_REDUCE_CROSSING_WALL', 'false'],
    ]);
  });
});

describe('parsePresetOptionLists', () => {
  it('reads the process and filament key lists, ignoring comments', () => {
    const lists = parsePresetOptionLists(`
      static std::vector<std::string> s_Preset_print_options{
          "layer_height", // first
          "wall_loops",
      };
      static std::vector<std::string> s_Preset_filament_options {/*"filament_colour", */ "filament_type",
          "nozzle_temperature"};
    `);

    expect(lists).toEqual({
      process: ['layer_height', 'wall_loops'],
      filament: ['filament_type', 'nozzle_temperature'],
    });
  });
});

describe('parseVariantKeys', () => {
  it('reads the per-variant setting sets, ignoring commented-out keys', () => {
    const keys = parseVariantKeys(`
      std::set<std::string> print_options_with_variant = {
          "outer_wall_speed",
          "print_extruder_variant", //coStrings
      };
      std::set<std::string> filament_options_with_variant = {
          "filament_flow_ratio",
          //"filament_extruder_id",
          "filament_extruder_variant",
      };
    `);

    expect(keys).toEqual({
      process: ['outer_wall_speed', 'print_extruder_variant'],
      filament: ['filament_flow_ratio', 'filament_extruder_variant'],
    });
  });
});
