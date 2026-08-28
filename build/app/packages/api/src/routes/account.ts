import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../context.js'
import { rateLimit, requireTrainer } from './plugin.js'
import * as privacy from '../services/privacy.js'
import * as admin from '../services/admin.js'

const ConfirmSchema = z.object({ confirm: z.string() })
const InviteSchema = z.object({
  maxUses: z.number().int().min(1).max(50).default(1),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(30),
  note: z.string().max(200).default(''),
})
const TargetSchema = z.object({ targetId: z.string().uuid(), value: z.boolean() })

export function registerAccountRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: [requireTrainer(ctx), rateLimit(ctx, 'action')] }
  const write = { preHandler: [requireTrainer(ctx), rateLimit(ctx, 'write_heavy')] }

  app.get('/api/account/export', auth, async (req, reply) => {
    const data = privacy.exportData(ctx, req.trainer!)
    // A download rather than a wall of JSON in a mobile browser.
    reply.header('content-disposition', `attachment; filename="spielstand-${req.trainer!.trainerCode}.json"`)
    reply.type('application/json')
    return data
  })

  app.post('/api/account/delete', write, async (req) => {
    const { confirm } = ConfirmSchema.parse(req.body)
    privacy.assertConfirmation(confirm)
    const result = privacy.deleteAccount(ctx, req.trainer!)
    return { deleted: true, ...result }
  })

  app.get('/api/admin', auth, async (req) => admin.dashboard(ctx, req.trainer!))

  app.post('/api/admin/invite', write, async (req) => {
    const body = InviteSchema.parse(req.body)
    const invite = admin.createInvite(ctx, req.trainer!, body.maxUses, body.expiresInDays, body.note)
    return { invite, dashboard: admin.dashboard(ctx, req.trainer!) }
  })

  app.post('/api/admin/invite/revoke', write, async (req) => {
    const { code } = z.object({ code: z.string() }).parse(req.body)
    admin.revokeInvite(ctx, req.trainer!, code)
    return admin.dashboard(ctx, req.trainer!)
  })

  app.post('/api/admin/ban', write, async (req) => {
    const { targetId, value } = TargetSchema.parse(req.body)
    admin.setBan(ctx, req.trainer!, targetId, value)
    return admin.dashboard(ctx, req.trainer!)
  })

  app.post('/api/admin/role', write, async (req) => {
    const { targetId, value } = TargetSchema.parse(req.body)
    admin.grantAdmin(ctx, req.trainer!, targetId, value)
    return admin.dashboard(ctx, req.trainer!)
  })
}
