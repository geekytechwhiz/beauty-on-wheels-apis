import { TemplateService } from '../services/TemplateService.js';
import { ITemplateRegistryProvider } from '../../../common/providers/ITemplateRegistryProvider.js';
import { environment } from '../../../common/config/environment.js';

jest.mock('../../../common/config/environment.js', () => ({
  environment: {
    contactListName: null as string | null,
  },
}));

describe('TemplateService', () => {
  let templateService: TemplateService;
  let mockRegistry: jest.Mocked<ITemplateRegistryProvider>;

  beforeEach(() => {
    mockRegistry = {
      createTemplate: jest.fn(),
      getTemplate: jest.fn(),
      deleteTemplate: jest.fn(),
      listTemplates: jest.fn(),
    };
    environment.contactListName = null;
    templateService = new TemplateService(mockRegistry);
  });

  describe('listTemplates', () => {
    it('should return a list of templates metadata', async () => {
      const mockList = [
        { Name: 'template-1', CreatedTimestamp: new Date() },
        { Name: 'template-2', CreatedTimestamp: new Date() },
      ];
      mockRegistry.listTemplates.mockResolvedValue(mockList);

      const result = await templateService.listTemplates();
      expect(result).toEqual(mockList);
      expect(mockRegistry.listTemplates).toHaveBeenCalledTimes(1);
    });
  });

  describe('getTemplate', () => {
    it('should return template content', async () => {
      const mockTemplate = {
        templateName: 'template-1',
        subject: 'My Subject',
        htmlContent: '<h1>Hello</h1>',
        textContent: 'Hello',
      };
      mockRegistry.getTemplate.mockResolvedValue(mockTemplate);

      const result = await templateService.getTemplate('template-1');
      expect(result).toEqual(mockTemplate);
      expect(mockRegistry.getTemplate).toHaveBeenCalledWith('template-1');
    });
  });

  describe('deleteTemplate', () => {
    it('should invoke delete on the template registry provider', async () => {
      mockRegistry.deleteTemplate.mockResolvedValue(undefined);

      await templateService.deleteTemplate('template-1');
      expect(mockRegistry.deleteTemplate).toHaveBeenCalledWith('template-1');
    });
  });

  describe('createTemplate', () => {
    it('should create template unmodified if it already contains the unsubscribe placeholder', async () => {
      environment.contactListName = 'email-system-contacts';
      const input = {
        templateName: 'my-template',
        subject: 'News',
        htmlContent: '<html><body>Content here {{amazonSESUnsubscribeUrl}}</body></html>',
        textContent: 'Visit {{amazonSESUnsubscribeUrl}} to opt out',
      };

      await templateService.createTemplate(input);

      expect(mockRegistry.createTemplate).toHaveBeenCalledWith({
        templateName: 'my-template',
        subject: 'News',
        htmlContent: input.htmlContent,
        textContent: input.textContent,
      });
    });

    it('should skip unsubscribe auto-inject when contactListName is not configured', async () => {
      environment.contactListName = null;
      const input = {
        templateName: 'my-template',
        subject: 'News',
        htmlContent: '<html><body>Welcome</body></html>',
        textContent: 'Welcome text',
      };

      await templateService.createTemplate(input);

      expect(mockRegistry.createTemplate).toHaveBeenCalledWith({
        templateName: 'my-template',
        subject: 'News',
        htmlContent: '<html><body>Welcome</body></html>',
        textContent: 'Welcome text',
      });
    });

    it('should auto-inject HTML and Text unsubscribe footer when contact list is configured and placeholder missing', async () => {
      environment.contactListName = 'email-system-contacts';
      const input = {
        templateName: 'my-template',
        subject: 'News',
        htmlContent: '<html><body>Welcome</body></html>',
        textContent: 'Welcome text',
      };

      await templateService.createTemplate(input);

      expect(mockRegistry.createTemplate).toHaveBeenCalledWith({
        templateName: 'my-template',
        subject: 'News',
        htmlContent:
          '<html><body>Welcome<p>To unsubscribe from this newsletter, <a href="{{amazonSESUnsubscribeUrl}}">click here</a>.</p></body></html>',
        textContent:
          'Welcome text\n\nTo unsubscribe from this newsletter, visit: {{amazonSESUnsubscribeUrl}}',
      });
    });

    it('should append HTML unsubscribe footer to end of file if no body tag present when contact list configured', async () => {
      environment.contactListName = 'email-system-contacts';
      const input = {
        templateName: 'my-template',
        subject: 'News',
        htmlContent: '<div>Content</div>',
      };

      await templateService.createTemplate(input);

      expect(mockRegistry.createTemplate).toHaveBeenCalledWith({
        templateName: 'my-template',
        subject: 'News',
        htmlContent:
          '<div>Content</div><p>To unsubscribe from this newsletter, <a href="{{amazonSESUnsubscribeUrl}}">click here</a>.</p>',
      });
    });
  });

  describe('createMultipleTemplates', () => {
    it('should return successful template names in successList', async () => {
      mockRegistry.createTemplate.mockResolvedValue(undefined);

      const result = await templateService.createMultipleTemplates([
        {
          templateName: 'template-a',
          subject: 'Subject A',
          htmlContent: '<p>A</p>',
        },
        {
          templateName: 'template-b',
          subject: 'Subject B',
          textContent: 'B',
        },
      ]);

      expect(result).toEqual({
        successList: ['template-a', 'template-b'],
        failedList: [],
      });
      expect(mockRegistry.createTemplate).toHaveBeenCalledTimes(2);
    });

    it('should separate successes and failures when one create fails', async () => {
      mockRegistry.createTemplate
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(Object.assign(new Error('exists'), { name: 'AlreadyExistsException' }));

      const result = await templateService.createMultipleTemplates([
        {
          templateName: 'template-ok',
          subject: 'Ok',
          htmlContent: '<p>Ok</p>',
        },
        {
          templateName: 'template-dup',
          subject: 'Dup',
          htmlContent: '<p>Dup</p>',
        },
      ]);

      expect(result).toEqual({
        successList: ['template-ok'],
        failedList: [
          {
            templateName: 'template-dup',
            message: 'Template already exists',
            code: 'CONFLICT',
          },
        ],
      });
    });
  });
});
