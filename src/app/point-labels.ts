// Translation keys for celestial points and aspects, shared by the inspector panels.
import type {MessageKey} from './translations';

export const POINT_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  Sun: 'name.sun', Moon: 'name.moon', Mercury: 'name.mercury', Venus: 'name.venus', Mars: 'name.mars',
  Jupiter: 'name.jupiter', Saturn: 'name.saturn', Uranus: 'name.uranus', Neptune: 'name.neptune',
  Pluto: 'name.pluto', Chiron: 'name.chiron',
  'true Node': 'name.trueNode', 'true Node Sud': 'name.trueNodeSouth',
  'mean Node': 'name.meanNode', 'mean Node Sud': 'name.meanNodeSouth',
  'osc. Apogee': 'name.oscApogee', 'osc. Perigee': 'name.oscPerigee',
  'mean Apogee': 'name.meanApogee', 'mean Perigee': 'name.meanPerigee',
  AS: 'angle.asc', MC: 'angle.mc', DS: 'angle.dsc', IC: 'angle.ic',
};

export const ASPECT_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  congiunzione: 'aspect.conjunction', opposizione: 'aspect.opposition', trigono: 'aspect.trine',
  quadrato: 'aspect.square', sestile: 'aspect.sextile', quinconce: 'aspect.quincunx',
  semisestile: 'aspect.semisextile', semiquadrato: 'aspect.semisquare', quintile: 'aspect.quintile',
  biquintile: 'aspect.biquintile', semiquintile: 'aspect.semiquintile', novile: 'aspect.novile',
  settile: 'aspect.septile', phisolare: 'aspect.phiSolar', philunare: 'aspect.phiLunar',
  parallelodideclinazione: 'aspect.parallel', antiparallelo: 'aspect.contraparallel',
};
