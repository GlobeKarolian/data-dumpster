/**
 * Minimal structural validation for dashboard widgets.
 *
 * The authoritative widget vocabulary lives with the dashboard renderer. This
 * schema deliberately validates only the envelope -- that each widget is an
 * object with a type, and that the array is a sane size -- and passes the rest
 * through untouched.
 *
 * The reason is coupling: if the API rejected every field the renderer had not
 * shipped yet, adding a widget would mean a coordinated deploy of two layers.
 * Validating the envelope stops jsonb from becoming a junk drawer while leaving
 * the renderer free to evolve.
 */
import { z } from 'zod';

export const widgetSchema = z.looseObject({
  type: z.string().trim().min(1).max(60),
  title: z.string().trim().max(160).optional(),
});

export const widgetsSchema = z.array(widgetSchema).max(60);

export type DashboardWidget = z.infer<typeof widgetSchema>;
