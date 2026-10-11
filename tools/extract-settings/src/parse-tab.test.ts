import { describe, expect, it } from 'vitest';
import { parseTabSections } from './parse-tab.ts';

const SOURCE = `
void TabPrint::build()
{
    auto page = add_options_page(L("Quality"), "custom-gcode_quality");
        auto optgroup = page->new_optgroup(L("Layer height"), L"param_layer_height");
        optgroup->append_single_option_line("layer_height", "quality_settings_layer_height");
        //optgroup->append_single_option_line("retired_option");
        optgroup = page->new_optgroup(L("Seam"), L"param_seam");
        optgroup->append_single_option_line("seam_position", "quality_settings_seam#seam-position");
    page = add_options_page(L("Others"), "custom-gcode_other");
        optgroup = page->new_optgroup(L("Fuzzy skin"), L"param_fuzzy_skin");
        optgroup->append_single_option_line("fuzzy_skin");
        optgroup->append_single_option_line("layer_height");
}

void TabFilament::add_filament_overrides_page()
{
    PageShp page = add_options_page(L("Setting Overrides"), "custom-gcode_setting_override");
    ConfigOptionsGroupShp retraction_optgroup = page->new_optgroup(L("Retraction"), L"param_retraction");
    for (const std::string opt_key : { "filament_retraction_length", "filament_z_hop" }) {}
}

void TabFilament::build()
{
    auto page = add_options_page(L("Filament"), "custom-gcode_filament");
        auto optgroup = page->new_optgroup(L("Print temperature"), L"param_extruder_temp");
        line.append_option(optgroup->get_option("nozzle_temperature", 0));
}
`;

const known = new Set([
  'layer_height',
  'seam_position',
  'fuzzy_skin',
  'retired_option',
  'nozzle_temperature',
  'filament_retraction_length',
  'filament_z_hop',
]);

describe('parseTabSections', () => {
  const sections = parseTabSections(SOURCE, known);

  it("places each process setting in its page and option group, in OrcaSlicer's order", () => {
    expect(Object.fromEntries(sections.process)).toEqual({
      layer_height: { page: 'Quality', group: 'Layer height', order: 0 },
      seam_position: { page: 'Quality', group: 'Seam', order: 1 },
      fuzzy_skin: { page: 'Others', group: 'Fuzzy skin', order: 2 },
    });
  });

  it('takes filament settings from the tab and its overrides page, and ignores comments', () => {
    expect(sections.filament.get('nozzle_temperature')).toMatchObject({
      page: 'Filament',
      group: 'Print temperature',
    });
    expect(sections.filament.get('filament_z_hop')).toMatchObject({
      page: 'Setting Overrides',
      group: 'Retraction',
    });
    expect(sections.process.has('retired_option')).toBe(false);
  });
});
