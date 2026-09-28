import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  Instances,
  OVERRIDE_FILE,
  VOLUMES_FILE,
  isInstanceName,
  overrideYaml,
  parseDdevDescribe,
  parseDdevList,
  removeGeneratedRouterFiles,
  renameHost,
  renamedHosts,
  suggestName,
  templateProblem,
  volumeProblem,
  volumesYaml,
  withStatus
} from '../src/main/instances.js'

// The last line of `ddev list --json-output` from DDEV v1.25.3, shortened.
const DDEV_LIST = [
  '{"level":"info","msg":"Loading projects","time":"2026-09-28T15:32:00Z"}',
  JSON.stringify({
    level: 'info',
    msg: '┌───────────┬────────┐\n│ NAME      │ STATUS │\n└───────────┴────────┘\n',
    raw: [
      {
        approot: '/home/dizzy/demo-instances/matomo-demo',
        httpsurl: 'https://matomo-demo.ddev.site',
        httpurl: 'http://matomo-demo.ddev.site',
        name: 'matomo-demo',
        primary_url: 'https://matomo-demo.ddev.site',
        status: 'running',
        type: 'php'
      },
      { approot: '/home/dizzy/Projects/matomo', name: 'matomo', primary_url: 'https://matomo.ddev.site', status: 'paused' }
    ]
  })
].join('\n')

test('test_isInstanceName_should_accept_a_lower_case_dns_label', () => {
  assert.equal(isInstanceName('matomo-demo-2'), true)
  assert.equal(isInstanceName('a'), true)
})

test('test_isInstanceName_should_reject_what_cannot_be_a_ddev_site_hostname', () => {
  for (const name of ['', 'Matomo', 'matomo_demo', '-matomo', 'matomo-', 'a.b', 'x'.repeat(64), '../x', null]) {
    assert.equal(isInstanceName(name), false, String(name))
  }
})

test('test_templateProblem_should_accept_a_folder_with_a_ddev_config', () => {
  const dir = ddevProject()
  assert.equal(templateProblem(dir), '')
})

test('test_templateProblem_should_explain_why_a_folder_is_not_a_template', () => {
  const dir = tempDir()
  assert.match(templateProblem(''), /Choose the folder/)
  assert.match(templateProblem('relative/path'), /Choose the folder/)
  assert.match(templateProblem(path.join(dir, 'gone')), /doesn't exist/)
  assert.match(templateProblem(dir), /isn't a DDEV project/)
})

test('test_removeGeneratedRouterFiles_should_remove_only_the_files_ddev_generated', () => {
  const dir = ddevProject()
  const traefik = path.join(dir, '.ddev', 'traefik')
  fs.mkdirSync(path.join(traefik, 'certs'), { recursive: true })
  fs.mkdirSync(path.join(traefik, 'config'))
  fs.writeFileSync(path.join(traefik, 'certs', 'template.crt'), '#ddev-generated\n-----BEGIN CERTIFICATE-----\n')
  fs.writeFileSync(path.join(traefik, 'certs', 'template.key'), '#ddev-generated\n-----BEGIN PRIVATE KEY-----\n')
  fs.writeFileSync(path.join(traefik, 'config', 'template.yaml'), '#ddev-generated\nhttp: {}\n')
  fs.writeFileSync(path.join(traefik, 'config', 'custom.yaml'), 'http: {}\n')
  assert.deepEqual(removeGeneratedRouterFiles(dir).sort(), ['certs/template.crt', 'certs/template.key', 'config/template.yaml'])
  assert.deepEqual(fs.readdirSync(path.join(traefik, 'config')), ['custom.yaml'])
  assert.deepEqual(fs.readdirSync(path.join(traefik, 'certs')), [])
})

test('test_removeGeneratedRouterFiles_should_do_nothing_for_a_project_that_never_started', () => {
  assert.deepEqual(removeGeneratedRouterFiles(ddevProject()), [])
})

test('test_suggestName_should_name_the_copy_after_the_template_folder', () => {
  assert.equal(suggestName('/home/me/Projects/Matomo_Plugins', []), 'matomo-plugins-demo')
})

test('test_suggestName_should_number_the_copy_when_the_name_is_taken', () => {
  assert.equal(suggestName('/p/matomo', ['matomo-demo', 'matomo-demo-2']), 'matomo-demo-3')
})

test('test_suggestName_should_fall_back_to_demo_when_the_folder_name_has_no_usable_characters', () => {
  assert.equal(suggestName('/p/___', []), 'demo-demo')
})

test('test_overrideYaml_should_set_the_project_name', () => {
  const yaml = overrideYaml('matomo-demo')
  assert.match(yaml, /^name: matomo-demo$/m)
  assert.doesNotMatch(yaml, /override_config/)
})

test('test_overrideYaml_should_replace_the_templates_host_lists_with_the_renamed_ones', () => {
  assert.equal(
    overrideYaml('wp-matomo-a', { additional_hostnames: ['wp-matomo-a-ms', '*.wp-matomo-a'] }).split('\n').slice(1).join('\n'),
    ['name: wp-matomo-a', 'override_config: true', 'additional_hostnames:', '  - "wp-matomo-a-ms"', '  - "*.wp-matomo-a"', ''].join('\n')
  )
})

test('test_parseDdevDescribe_should_split_the_hosts_into_hostnames_and_fqdns', () => {
  // As DDEV v1.25.3 reports a project with additional_hostnames [wp-matomo-ms,
  // other] and additional_fqdns [wp-matomo-x.example.com], shortened.
  const output = [
    '{"level":"info","msg":"Loading"}',
    JSON.stringify({
      level: 'info',
      raw: {
        name: 'wp-matomo',
        hostname: 'wp-matomo.ddev.site',
        hostnames: ['wp-matomo.ddev.site', 'other.ddev.site', 'wp-matomo-ms.ddev.site', 'wp-matomo-x.example.com']
      }
    })
  ].join('\n')
  assert.deepEqual(parseDdevDescribe(output), { name: 'wp-matomo', hostnames: ['other', 'wp-matomo-ms'], fqdns: ['wp-matomo-x.example.com'] })
})

test('test_parseDdevDescribe_should_throw_when_there_is_no_project', () => {
  assert.throws(() => parseDdevDescribe('{"level":"fatal","msg":"no project"}'), /Couldn't read the project/)
})

test('test_renameHost_should_give_a_host_beginning_with_the_project_name_the_copys_name', () => {
  assert.equal(renameHost('wp-matomo-ms', 'wp-matomo', 'wp-matomo-a'), 'wp-matomo-a-ms')
  assert.equal(renameHost('wp-matomo', 'wp-matomo', 'wp-matomo-a'), 'wp-matomo-a')
  assert.equal(renameHost('*.wp-matomo', 'wp-matomo', 'wp-matomo-a'), '*.wp-matomo-a')
  assert.equal(renameHost('wp-matomo.example.com', 'wp-matomo', 'wp-matomo-a'), 'wp-matomo-a.example.com')
})

test('test_renameHost_should_leave_out_a_host_that_only_contains_the_project_name', () => {
  assert.equal(renameHost('other', 'wp-matomo', 'wp-matomo-a'), null)
  assert.equal(renameHost('wp-matomos', 'wp-matomo', 'wp-matomo-a'), null)
  assert.equal(renameHost('ms-wp-matomo', 'wp-matomo', 'wp-matomo-a'), null)
})

test('test_renamedHosts_should_replace_only_the_lists_with_a_renamed_host', () => {
  const described = { name: 'wp-matomo', hostnames: ['wp-matomo-ms', 'other'], fqdns: ['shop.example.com'] }
  assert.deepEqual(renamedHosts(described, 'wp-matomo-a'), {
    hosts: { additional_hostnames: ['wp-matomo-a-ms', 'other'] },
    kept: ['other', 'shop.example.com']
  })
})

test('test_renamedHosts_should_change_nothing_for_a_template_without_extra_hosts', () => {
  assert.deepEqual(renamedHosts({ name: 'matomo', hostnames: [], fqdns: [] }, 'matomo-a'), { hosts: {}, kept: [] })
})

test('test_volumeProblem_should_accept_an_existing_folder_mounted_at_an_absolute_path', () => {
  assert.equal(volumeProblem({ source: tempDir(), target: '/var/www/html/plugins/Foo', service: 'web' }), '')
})

test('test_volumeProblem_should_explain_what_is_wrong_with_a_volume', () => {
  const dir = tempDir()
  assert.match(volumeProblem({ source: 'relative', target: '/x', service: 'web' }), /absolute path\./)
  assert.match(volumeProblem({ source: path.join(dir, 'gone'), target: '/x', service: 'web' }), /doesn't exist/)
  assert.match(volumeProblem({ source: dir, target: 'x', service: 'web' }), /absolute path in the container/)
  assert.match(volumeProblem({ source: dir, target: '/', service: 'web' }), /absolute path in the container/)
  assert.match(volumeProblem({ source: dir, target: '/x', service: 'web server' }), /isn't a service name/)
})

test('test_volumesYaml_should_group_the_mounts_by_service', () => {
  const yaml = volumesYaml([
    { source: '/a', target: '/var/www/html/a', service: 'web', readOnly: true },
    { source: '/b', target: '/b', service: 'db', readOnly: false },
    { source: '/c "quoted"', target: '/c', service: 'web', readOnly: false }
  ])
  assert.equal(
    yaml.split('\n').slice(1).join('\n'),
    [
      'services:',
      '  "web":',
      '    volumes:',
      '      - {"type": "bind", "source": "/a", "target": "/var/www/html/a", "read_only": true}',
      '      - {"type": "bind", "source": "/c \\"quoted\\"", "target": "/c", "read_only": false}',
      '  "db":',
      '    volumes:',
      '      - {"type": "bind", "source": "/b", "target": "/b", "read_only": false}',
      ''
    ].join('\n')
  )
})

test('test_volumesYaml_should_write_nothing_without_volumes', () => {
  assert.equal(volumesYaml([]), '')
})

test('test_parseDdevList_should_read_the_projects_from_the_last_json_line', () => {
  assert.deepEqual(parseDdevList(DDEV_LIST), [
    {
      name: 'matomo-demo',
      status: 'running',
      approot: '/home/dizzy/demo-instances/matomo-demo',
      url: 'https://matomo-demo.ddev.site',
      httpUrl: 'http://matomo-demo.ddev.site'
    },
    { name: 'matomo', status: 'paused', approot: '/home/dizzy/Projects/matomo', url: 'https://matomo.ddev.site', httpUrl: '' }
  ])
})

test('test_parseDdevList_should_throw_when_there_is_no_project_list', () => {
  assert.throws(() => parseDdevList('bash: ddev: some warning\n{"level":"info","msg":"x"}'), /Couldn't read the project list/)
})

test('test_withStatus_should_add_the_status_of_the_project_in_the_same_folder', () => {
  const dir = tempDir()
  const instances = [
    { name: 'running-one', dir },
    { name: 'other-folder', dir },
    { name: 'unknown', dir },
    { name: 'gone', dir: path.join(dir, 'gone') }
  ]
  const projects = [
    { name: 'running-one', status: 'running', approot: dir + '/', url: 'https://running-one.ddev.site', httpUrl: 'http://running-one.ddev.site' },
    { name: 'other-folder', status: 'running', approot: '/elsewhere', url: 'https://other-folder.ddev.site', httpUrl: '' }
  ]
  assert.deepEqual(
    withStatus(instances, projects).map(({ name, status, url }) => ({ name, status, url })),
    [
      { name: 'running-one', status: 'running', url: 'https://running-one.ddev.site' },
      { name: 'other-folder', status: 'not created', url: '' },
      { name: 'unknown', status: 'not created', url: '' },
      { name: 'gone', status: 'missing', url: '' }
    ]
  )
})

test('test_writeVolumes_should_write_the_compose_file_and_remove_it_when_there_are_none', () => {
  const dir = ddevProject()
  const file = path.join(dir, '.ddev', VOLUMES_FILE)
  const instances = new Instances()
  instances.writeVolumes({ dir, volumes: [{ source: '/a', target: '/a', service: 'web', readOnly: false }] })
  assert.match(fs.readFileSync(file, 'utf8'), /"source": "\/a"/)
  instances.writeVolumes({ dir, volumes: [] })
  assert.equal(fs.existsSync(file), false)
})

test('test_discardCopy_should_delete_a_copy_holding_the_override_file', async () => {
  const settings = { instancesDir: tempDir(), ddevPath: 'ddev' }
  const dir = ddevProject()
  fs.writeFileSync(path.join(dir, '.ddev', OVERRIDE_FILE), overrideYaml('x'))
  await new Instances().discardCopy(settings, '/template', dir, 'copy')
  assert.equal(fs.existsSync(dir), false)
})

test('test_discardCopy_should_delete_a_partial_copy_in_the_instances_folder', async () => {
  const settings = { instancesDir: tempDir(), ddevPath: 'ddev' }
  const dir = path.join(settings.instancesDir, 'half-copied')
  fs.mkdirSync(dir)
  await new Instances().discardCopy(settings, '/template', dir, 'copy')
  assert.equal(fs.existsSync(dir), false)
})

test('test_discardCopy_should_refuse_to_delete_a_folder_it_did_not_make', async () => {
  const settings = { instancesDir: tempDir(), ddevPath: 'ddev' }
  const dir = ddevProject()
  await assert.rejects(new Instances().discardCopy(settings, '/template', dir, 'copy'), /doesn't look like an instance copy/)
  assert.equal(fs.existsSync(path.join(dir, '.ddev', 'config.yaml')), true)
})

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qdc-instances-test-'))
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function ddevProject() {
  const dir = tempDir()
  fs.mkdirSync(path.join(dir, '.ddev'))
  fs.writeFileSync(path.join(dir, '.ddev', 'config.yaml'), 'name: template\ntype: php\n')
  return dir
}
