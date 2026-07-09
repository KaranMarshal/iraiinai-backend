import { Request, Response } from 'express';
import { Content } from '../models/Content';

export class ContentController {
  /**
   * Get all content, optionally filtered by type
   */
  static async getAllContent(req: Request, res: Response) {
    try {
      const { type } = req.query;
      const query = type ? { type } : {};
      
      const contents = await Content.find(query).sort({ priority: -1, createdAt: -1 });
      
      res.status(200).json({ success: true, data: contents });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Create new content
   */
  static async createContent(req: Request, res: Response) {
    try {
      const { type, title, body, imageUrl, linkUrl, isActive, priority } = req.body;
      
      if (!type || !title) {
        return res.status(400).json({ success: false, message: 'Type and Title are required' });
      }

      const content = await Content.create({
        type, title, body, imageUrl, linkUrl, isActive, priority
      });

      res.status(201).json({ success: true, message: 'Content created', data: content });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Update existing content
   */
  static async updateContent(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const updates = req.body;

      const content = await Content.findByIdAndUpdate(id, updates, { new: true });
      if (!content) {
        return res.status(404).json({ success: false, message: 'Content not found' });
      }

      res.status(200).json({ success: true, message: 'Content updated', data: content });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Delete content
   */
  static async deleteContent(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const content = await Content.findByIdAndDelete(id);
      
      if (!content) {
        return res.status(404).json({ success: false, message: 'Content not found' });
      }

      res.status(200).json({ success: true, message: 'Content deleted successfully' });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}
