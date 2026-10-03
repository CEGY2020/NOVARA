"""Synthetic portfolio tests; never send source customer data to the repository."""
import base64
import copy
import sys
from decimal import Decimal
from test_customer_forms import FormsTest
import structured_forms

SOURCE = '''Example Management - Regional Contacts
PROPERTY MANAGEMENT
Address
100 Office Rd, Suite 2, Sample City, CA 90001
Phone
949-555-0100 - regional office switchboard
Example Management - Contact Directory
Pat Sample
Regional Maintenance Manager
Example Management - Site Savings Estimates
First Pool
10 Main St, Sample City, CA 90001
Second Pool
20 Main St, Sample City, CA 90002
First Pool
Example page active
4 pools; 1 advertised heated
Second Pool
CONFIRM CURRENT MANAGER
2 pools; management needs confirmation
progress: Called the office.
Ask for maintenance next week.
c1_datetime: 2026-10-02
c1_method: Call
c1_notes: Left message
site_0_area: 1765
site_0_rate: 310
site_0_monthly: 99999
site_0_annual: 99999
site_1_rate: 310
'''


class StructuredTest(FormsTest):
    def setUp(self):
        super().setUp()
        self.previous_forms=sys.modules.get('customer_forms')
        sys.modules['customer_forms']=self.forms
        self.api.OWNERS_TABLE_NAME='owners';self.api.MGMT_COMPANIES_TABLE_NAME='managers'
        self.api.ensure_owners_table=lambda:None;self.api.ensure_mgmt_companies_table=lambda:None
        self.bundle=structured_forms.parse(SOURCE)
        self.body={'fileName':'Portfolio.csv','fileBase64':base64.b64encode(SOURCE.encode()).decode(),'structured':self.bundle,'reviewed':True}

    def tearDown(self):
        if self.previous_forms is None:sys.modules.pop('customer_forms',None)
        else:sys.modules['customer_forms']=self.previous_forms
        super().tearDown()

    def batch(self):return structured_forms.commit(self.body,{'userId':'test'})

    def test_parse_and_structured_save(self):
        self.assertEqual(len(self.bundle['sites']),2)
        self.assertEqual(len(self.bundle['contacts']),1)
        self.assertIn('Ask for maintenance',self.bundle['company']['Notes'])
        result=self.batch()
        self.assertEqual(len(self.store.tables['sites']),2)
        self.assertEqual(len(self.store.tables['managers']),1)
        self.assertFalse(self.store.tables['owners'])
        site=self.store.tables['sites'][result['siteIds'][0]]
        self.assertEqual(site['PoolAreaSqFt'],Decimal('1765'))
        self.assertEqual(site['EstimatedAnnualSavings'],Decimal('8207.25'))
        self.assertEqual(site['PoolCount'],4)
        self.assertNotIn('OwnerID',site)
        unconfirmed=self.store.tables['sites'][result['siteIds'][1]]
        self.assertNotIn('MgmtCompanyID',unconfirmed)
        self.assertNotIn('CompanyID',unconfirmed)
        contact=next(iter(self.store.tables['contacts'].values()))
        self.assertEqual(contact['Scope'],'Company');self.assertEqual(contact['SiteID'],'')
        self.assertNotIn('Phone',contact);self.assertEqual(contact['OfficePhone'],'949-555-0100')
        self.assertTrue(all(not l.get('Notes') for l in self.store.tables['leads'].values()))
        metadata=self.store.tables['settings'][result['formId']]
        self.assertEqual(metadata['ContactHistory'][0]['Outcome'],'Left message')
        self.assertTrue(self.batch()['alreadyImported'])

    def test_explicit_owner_and_site_contact(self):
        self.bundle['sites'][0]['OwnerName']='Example Owner LLC'
        self.bundle['contacts'][0].update(Scope='Site',SiteName='First Pool',Email='pat@example.com')
        r=self.batch();site=self.store.tables['sites'][r['siteIds'][0]]
        self.assertEqual(self.store.tables['owners'][site['OwnerID']]['Name'],'Example Owner LLC')
        self.assertEqual(next(iter(self.store.tables['contacts'].values()))['SiteID'],site['SiteID'])

    def test_invalid_batch_is_atomic(self):
        self.bundle['sites'][1]['PoolAreaSqFt']='NaN'
        with self.assertRaisesRegex(ValueError,'outside'):self.batch()
        self.assertFalse(any(self.store.tables.values()))
        self.bundle['sites'][1]['PoolAreaSqFt']=''
        self.bundle['contacts'][0]['Email']='Not verified'
        with self.assertRaisesRegex(ValueError,'valid email'):self.batch()
        self.assertFalse(any(self.store.tables.values()))

    def test_existing_values_and_notes_preserved(self):
        r=self.batch();sid=r['siteIds'][0];lid=r['leadIds'][0]
        self.store.tables['sites'][sid].update(Systems=8,Phone='555-555-0100')
        self.store.tables['leads'][lid]['Notes']='Prior actual call'
        self.body['fileBase64']=base64.b64encode(b'Updated portfolio').decode()
        self.batch()
        self.assertEqual(self.store.tables['sites'][sid]['Systems'],8)
        self.assertEqual(self.store.tables['sites'][sid]['Phone'],'555-555-0100')
        self.assertEqual(self.store.tables['leads'][lid]['Notes'],'Prior actual call')

    def test_review_and_ambiguity(self):
        self.body['reviewed']=False
        with self.assertRaisesRegex(ValueError,'Review'):self.batch()
        self.body['reviewed']=True;r=self.batch()
        original=self.store.tables['sites'][r['siteIds'][0]]
        self.store.tables['sites']['DUP']={**original,'SiteID':'DUP'}
        self.body['fileBase64']=base64.b64encode(b'New version').decode()
        with self.assertRaisesRegex(ValueError,'More than one site'):self.batch()
