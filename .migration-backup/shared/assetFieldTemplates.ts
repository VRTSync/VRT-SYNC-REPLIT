export type FieldDef = {
  key: string;
  label: string;
  required?: boolean;
  source: 'property' | 'column';
};

export type FieldSection = {
  title: string;
  fields: FieldDef[];
};

export type AssetFieldTemplate = {
  displayName: string;
  sections: FieldSection[];
};

export const ASSET_FIELD_TEMPLATES: Record<string, AssetFieldTemplate> = {
  native_area: {
    displayName: 'Native Grass',
    sections: [
      {
        title: 'Area Details',
        fields: [
          { key: 'maintenanceResponsibility', label: 'Maintenance Responsibility', source: 'property' },
          { key: 'serviceNotes', label: 'Service Notes', source: 'property' },
          { key: 'defaultBillingCategory', label: 'Default Billing Category', source: 'property' },
        ],
      },
    ],
  },
  landscape_bed: {
    displayName: 'Landscape Bed',
    sections: [
      {
        title: 'Bed Details',
        fields: [
          { key: 'bedType', label: 'Bed Type', source: 'property' },
          { key: 'irrigationType', label: 'Irrigation Type', source: 'property' },
          { key: 'plantingNotes', label: 'Planting Notes', source: 'property' },
          { key: 'materialNotes', label: 'Material Notes', source: 'property' },
          { key: 'lastEnhancementDate', label: 'Last Enhancement Date', source: 'property' },
          { key: 'warrantyEndDate', label: 'Warranty End Date', source: 'property' },
        ],
      },
    ],
  },
  bluegrass_area: {
    displayName: 'Bluegrass Area',
    sections: [
      {
        title: 'Area Details',
        fields: [
          { key: 'serviceNotes', label: 'Service Notes', source: 'property' },
        ],
      },
    ],
  },
  pet_station: {
    displayName: 'Pet Station',
    sections: [
      {
        title: 'Station Details',
        fields: [
          { key: 'stationCode', label: 'Station Code', required: true, source: 'property' },
          { key: 'serviceFrequency', label: 'Service Frequency', source: 'property' },
          { key: 'bagType', label: 'Bag Type', source: 'property' },
          { key: 'canSize', label: 'Can Size', source: 'property' },
          { key: 'placementNotes', label: 'Placement Notes', source: 'property' },
        ],
      },
    ],
  },
  backflow: {
    displayName: 'Backflow',
    sections: [
      {
        title: 'Device Info',
        fields: [
          { key: 'backflowType', label: 'Backflow Type', source: 'property' },
          { key: 'brand', label: 'Brand', required: true, source: 'property' },
          { key: 'model', label: 'Model', source: 'property' },
          { key: 'size', label: 'Size', required: true, source: 'property' },
          { key: 'serialNumber', label: 'Serial Number', required: true, source: 'property' },
        ],
      },
      {
        title: 'Service History',
        fields: [
          { key: 'installDate', label: 'Install Date', source: 'property' },
          { key: 'lastTestDate', label: 'Last Test Date', source: 'property' },
          { key: 'testDueDate', label: 'Test Due Date', source: 'property' },
          { key: 'locationNotes', label: 'Location Notes', source: 'property' },
        ],
      },
    ],
  },
  controller: {
    displayName: 'Controller',
    sections: [
      {
        title: 'Controller Info',
        fields: [
          { key: 'controllerCode', label: 'Controller Code', required: true, source: 'property' },
          { key: 'brand', label: 'Brand', required: true, source: 'property' },
          { key: 'model', label: 'Model', source: 'property' },
          { key: 'installDate', label: 'Install Date', source: 'property' },
          { key: 'locationNotes', label: 'Location Notes', source: 'property' },
        ],
      },
    ],
  },
  zone: {
    displayName: 'Zone',
    sections: [
      {
        title: 'Zone Info',
        fields: [
          { key: 'controllerFeatureRef', label: 'Controller ID', required: true, source: 'property' },
          { key: 'zoneNumber', label: 'Zone Number', required: true, source: 'property' },
          { key: 'zoneType', label: 'Zone Type', source: 'property' },
          { key: 'brand', label: 'Brand', source: 'property' },
          { key: 'installDate', label: 'Install Date', source: 'property' },
          { key: 'locationNotes', label: 'Location Notes', source: 'property' },
        ],
      },
    ],
  },
  snow_area: {
    displayName: 'Snow Area',
    sections: [
      {
        title: 'Snow Details',
        fields: [
          { key: 'eventStart', label: 'Event Start', source: 'property' },
          { key: 'eventEnd', label: 'Event End', source: 'property' },
          { key: 'accumulationRange', label: 'Accumulation Range', source: 'property' },
          { key: 'notes', label: 'Notes', source: 'property' },
        ],
      },
    ],
  },
  tree: {
    displayName: 'Tree',
    sections: [
      {
        title: 'Tree Info',
        fields: [
          { key: 'treeCode', label: 'Tree Code', source: 'property' },
          { key: 'species', label: 'Species', required: true, source: 'property' },
          { key: 'caliper', label: 'Caliper', source: 'property' },
          { key: 'installDate', label: 'Install Date', source: 'property' },
          { key: 'warrantyEndDate', label: 'Warranty End Date', source: 'property' },
          { key: 'healthStatus', label: 'Health Status', source: 'property' },
          { key: 'treatmentNotes', label: 'Treatment Notes', source: 'property' },
          { key: 'locationNotes', label: 'Location Notes', source: 'property' },
        ],
      },
    ],
  },
};

export function getTemplateKeys(assetType: string): Set<string> {
  const template = ASSET_FIELD_TEMPLATES[assetType];
  if (!template) return new Set();
  const keys = new Set<string>();
  for (const section of template.sections) {
    for (const field of section.fields) {
      if (field.source === 'property') keys.add(field.key);
    }
  }
  keys.add('sqFt');
  keys.add('name');
  return keys;
}

export function getRequiredFieldsMissing(
  assetType: string,
  properties: { key: string; value: string }[],
): { count: number; fields: string[] } {
  const template = ASSET_FIELD_TEMPLATES[assetType];
  if (!template) return { count: 0, fields: [] };
  const propKeys = new Set(properties.map(p => p.key));
  const missing: string[] = [];
  for (const section of template.sections) {
    for (const field of section.fields) {
      if (field.required && field.source === 'property') {
        const prop = properties.find(p => p.key === field.key);
        if (!prop || !prop.value.trim()) {
          missing.push(field.label);
        }
      }
    }
  }
  return { count: missing.length, fields: missing };
}
