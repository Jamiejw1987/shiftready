/**
 * The checks on the Manual Handling Practical Training Assessment, in the sheet's own words and order.
 * x/y: where "Yes" is printed for that check, in pixels on the sheet scanned at 200 dpi (used to ring the answer).
 */
export type MhItem = { id: string; section: string; heading: string; text?: string; page: 1 | 2; x: number; y: number };

const h1 = 'Understanding of the task and ability to question uncertain instructions clear, precise and reasonable';
const h8 = 'Undertake a proper LOW LEVEL lifting technique';
const hPush = 'Undertake a proper PUSHING technique';
const hPull = 'Undertake a proper PULLING technique';
const h9 = 'Walking undertaking a proper technique';
const h10 = 'Carefully setting down the load';

export const MH_ITEMS: MhItem[] = [
  { id: '1', section: '1', heading: h1, page: 1, x: 1255, y: 898 },
  { id: '2', section: '2', heading: 'Examination of the load and undertake personal capability assessment', text: 'Is the load bulky or unwieldy, unstable, difficult to grasp, has sharp edges? Is the task within the candidate’s capabilities?', page: 1, x: 1254, y: 1004 },
  { id: '3', section: '3', heading: 'Planning a method of working to undertake the task safely and successfully', text: 'Identify the best route from A to B. Can the task be done alone or is help needed? Are mechanical aids available and can they be used safely?', page: 1, x: 1254, y: 1107 },
  { id: '4', section: '4', heading: 'Consideration of wearing Personal Protective clothing', text: 'Are particular items of PPE required, i.e. gloves, face masks, etc.? Could the wearing of the PPE interfere with the task?', page: 1, x: 1253, y: 1243 },
  { id: '5', section: '5', heading: 'Walking the route, identify particular hazards and take remedial action', text: 'Wet or slippery floor surfaces, variations in floor level, low headroom, excessive heat or cold, closed doors or barriers', page: 1, x: 1252, y: 1383 },
  { id: '6', section: '6', heading: 'Consideration of personal positioning and others', text: 'Are you and the people around you safe from action?', page: 1, x: 1251, y: 1515 },
  { id: '7', section: '7', heading: 'Decide on how to hold and restrain the load', text: 'Does the load require: one or two handed grip, rolling, pushing/pulling, carrying on the shoulder?', page: 1, x: 1251, y: 1658 },
  { id: '8a', section: '8', heading: h8, text: 'Stand close to the load with centre of gravity over the load', page: 1, x: 1250, y: 1830 },
  { id: '8b', section: '8', heading: h8, text: 'Position the feet apart, with the leading leg as far forward as possible', page: 1, x: 1250, y: 1867 },
  { id: '8c', section: '8', heading: h8, text: 'Squat down by bending knees, keeping the back straight', page: 1, x: 1249, y: 1905 },
  { id: '8d', section: '8', heading: h8, text: 'Keep shoulders level and facing in the same direction as the hips', page: 1, x: 1249, y: 1940 },
  { id: '8e', section: '8', heading: h8, text: 'Get a secure grip, with the fingers under the load if possible, arms tucked into body', page: 1, x: 1249, y: 1979 },
  { id: '8f', section: '8', heading: h8, text: 'Get into a mid range lift by raising head and sticking backside out', page: 1, x: 1249, y: 2014 },
  { id: '8g', section: '8', heading: h8, text: 'Raise the body slowly by straightening the knees (keeping the back straight)', page: 1, x: 1249, y: 2053 },
  { id: '8h', section: '8', heading: h8, text: 'Do not jerk or twist while lifting', page: 1, x: 1249, y: 2091 },
  { id: '8i', section: '8', heading: h8, text: 'Keep load close to the body with the heaviest side nearest the body', page: 1, x: 1249, y: 2126 },
  { id: 'pu1', section: 'Pushing', heading: hPush, text: 'Good understanding of the load weight and force required to initiate movement', page: 2, x: 1153, y: 315 },
  { id: 'pu2', section: 'Pushing', heading: hPush, text: 'Good base support with leading leg forward', page: 2, x: 1153, y: 383 },
  { id: 'pu3', section: 'Pushing', heading: hPush, text: 'Forward leaning motion with soft knees and arms', page: 2, x: 1153, y: 417 },
  { id: 'pu4', section: 'Pushing', heading: hPush, text: 'Elbows within body framework and hands between shoulders and hips', page: 2, x: 1153, y: 452 },
  { id: 'pu5', section: 'Pushing', heading: hPush, text: 'Forward pushing motion with no twisting involved', page: 2, x: 1153, y: 486 },
  { id: 'pl1', section: 'Pulling', heading: hPull, text: 'Good understanding of the load weight and force required to initiate movement', page: 2, x: 1153, y: 558 },
  { id: 'pl2', section: 'Pulling', heading: hPull, text: 'Good support with open stance', page: 2, x: 1153, y: 626 },
  { id: 'pl3', section: 'Pulling', heading: hPull, text: 'Two handed grip to initiate movement of load', page: 2, x: 1153, y: 659 },
  { id: 'pl4', section: 'Pulling', heading: hPull, text: 'Backwards leaning motion with soft knees and arms', page: 2, x: 1153, y: 691 },
  { id: 'pl5', section: 'Pulling', heading: hPull, text: 'Use of one handed underhand grip once load moving', page: 2, x: 1153, y: 727 },
  { id: '9a', section: '9', heading: h9, text: 'Clear vision', page: 2, x: 1153, y: 837 },
  { id: '9b', section: '9', heading: h9, text: 'Travelling in the face direction (if one person lift used)', page: 2, x: 1153, y: 868 },
  { id: '9c', section: '9', heading: h9, text: 'Load close to body', page: 2, x: 1153, y: 902 },
  { id: '9d', section: '9', heading: h9, text: 'Arms tucked into side', page: 2, x: 1153, y: 939 },
  { id: '9e', section: '9', heading: h9, text: 'Provision for rest if needed', page: 2, x: 1153, y: 970 },
  { id: '9f', section: '9', heading: h9, text: 'Unchanged grip whilst walking', page: 2, x: 1153, y: 1007 },
  { id: '9g', section: '9', heading: h9, text: 'Avoidance of twisting body', page: 2, x: 1154, y: 1041 },
  { id: '9h', section: '9', heading: h9, text: 'Use of help if needed', page: 2, x: 1154, y: 1075 },
  { id: '10a', section: '10', heading: h10, text: 'Good positioning of body', page: 2, x: 1154, y: 1147 },
  { id: '10b', section: '10', heading: h10, text: 'Bending the knees when setting load down', page: 2, x: 1154, y: 1181 },
  { id: '10c', section: '10', heading: h10, text: 'Keeping the back straight', page: 2, x: 1154, y: 1215 },
  { id: '10d', section: '10', heading: h10, text: 'Care of fingers when setting down', page: 2, x: 1154, y: 1249 },
  { id: '10e', section: '10', heading: h10, text: 'Positioning the load safely after setting down', page: 2, x: 1154, y: 1280 },
];
