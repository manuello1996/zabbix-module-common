"""Opt-in local integration checks. Creates and always removes a temporary read-only user/role/group.

Run with ZABBIX_PASSWORD set. Does not execute or modify monitoring items.
"""
import http.cookiejar
from html.parser import HTMLParser
import json
import os
import secrets
import urllib.parse
import urllib.request


class Elements(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.menus = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'data-menu-popup' in attrs:
            menu = json.loads(attrs['data-menu-popup'])
            if menu['type'] == 'item':
                self.menus.append(menu)


def main():
    url = os.getenv('ZABBIX_URL', 'http://127.0.0.1').rstrip('/')
    username = os.getenv('ZABBIX_USERNAME', 'Admin')
    password = os.environ['ZABBIX_PASSWORD']
    token = None

    def api(method, params):
        body = {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}
        if token:
            body['auth'] = token
        request = urllib.request.Request(url + '/api_jsonrpc.php', json.dumps(body).encode(),
                                         {'Content-Type': 'application/json-rpc'})
        result = json.load(urllib.request.urlopen(request, timeout=40))
        if 'error' in result:
            raise RuntimeError(method + ': ' + result['error'].get('data', 'API error'))
        return result['result']

    def login(user, passwd):
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        opener.open(url + '/index.php', urllib.parse.urlencode(
            {'name': user, 'password': passwd, 'enter': 'Sign in'}).encode(), timeout=30).read()
        return opener

    def get(opener, action, **params):
        response = opener.open(url + '/zabbix.php?' + urllib.parse.urlencode(
            {'action': action, **params}, doseq=True), timeout=60).read().decode()
        assert 'Fatal error:' not in response and 'Uncaught ' not in response, action
        return response

    def menu(opener, source):
        data = source['data']
        response = json.loads(get(opener, 'menu.popup', type='item', **{
            'data[itemid]': data['itemid'], 'data[backurl]': data['backurl']}))
        return response.get('data', response)

    created = []
    try:
        token = api('user.login', {'username': username, 'password': password})
        admin = login(username, password)
        hosts = api('host.get', {'output': ['hostid', 'host', 'name'], 'selectHostGroups': ['groupid']})
        forti = next(host for host in hosts if host['host'] == 'fortinet-module-demo-fg-a')
        vmware = next(host for host in hosts if host['host'] == 'vmware-module-demo')
        netapp = next(host for host in hosts if host['host'] == 'netapp-module-demo')
        docker = api('item.get', {'output': ['hostid'], 'filter': {'key_': 'docker.ping'}, 'monitored': True})[0]
        cases = [
            ('VMware', 'vmware.monitoring.view', {'filter_hostid[]': vmware['hostid'], 'filter_set': 1}),
            ('NetApp', 'netapp.monitoring.view', {'hostid': netapp['hostid']}),
            ('Docker', 'docker.view', {'filter_hostid[]': docker['hostid'], 'filter_set': 1}),
            ('Fortinet', 'fortigate.overview.device', {'hostid': forti['hostid']})
        ]
        sources = []
        pages = []
        for label, action, params in cases:
            page = get(admin, action, **params)
            assert 'ItemActions.install(' in page, label + ' handlers not initialized'
            assert page.count('src="js/items.js') <= 1, label + ' duplicate native asset'
            if label == 'Docker':
                tab = json.loads(get(admin, 'docker.tab', hostid=docker['hostid'], tab='node'))
                if 'main_block' in tab:
                    tab = json.loads(tab['main_block'])
                page += tab['html']
            entries = Elements(page).menus
            assert entries, label + ' has no item menu'
            for source in entries[:4]:
                result = menu(admin, source)
                assert result.get('itemid') == source['data']['itemid'], (label, list(result))
                assert result['isWriteable'] and result['allowed_ui_conf_hosts'], label
                sources.append((label, source, result))
            pages.append((label, action, params))
            print(label + ': shared handlers, native item menu and admin access verified.')

        # Include numeric and text items even if an inventory's first few values happen to be numeric.
        sample_hostids = list({entry[2]['hostid'] for entry in sources})
        items = api('item.get', {'output': ['itemid', 'hostid', 'value_type', 'type'], 'hostids': sample_hostids})
        for value_type in ('0', '3', '4'):
            item = next((item for item in items if item['value_type'] == value_type), None)
            if item:
                source = {'data': {'itemid': item['itemid'], 'backurl': 'zabbix.php?action=latest.view'}}
                result = menu(admin, source)
                assert result['showGraph'] == (value_type in ('0', '3'))
                sources.append(('value type ' + value_type, source, result))

        suffix = secrets.token_hex(6)
        roleid = api('role.create', {'name': 'Common item menu check ' + suffix, 'type': 1,
            'rules': {'ui.default_access': 1, 'modules.default_access': 1,
                      'actions.default_access': 0, 'api.access': 0,
                      'actions': [{'name': 'invoke_execute_now', 'status': 0}]}})['roleids'][0]
        created.append(('role.delete', [roleid]))
        groupids = {group['groupid'] for host in hosts if host['hostid'] in sample_hostids for group in host['hostgroups']}
        templates = api('template.get', {'output': ['templateid'], 'hostids': sample_hostids,
                                         'selectTemplateGroups': ['groupid']})
        template_groupids = {group['groupid'] for template in templates for group in template['templategroups']}
        usrgrpid = api('usergroup.create', {'name': 'Common item menu check ' + suffix,
            'hostgroup_rights': [{'id': groupid, 'permission': 2} for groupid in groupids],
            'templategroup_rights': [{'id': groupid, 'permission': 2} for groupid in template_groupids]})['usrgrpids'][0]
        created.append(('usergroup.delete', [usrgrpid]))
        temp_user = 'common-menu-check-' + suffix
        temp_password = secrets.token_urlsafe(24) + 'Aa1!'
        userid = api('user.create', {'username': temp_user, 'passwd': temp_password, 'roleid': roleid,
            'usrgrps': [{'usrgrpid': usrgrpid}]})['userids'][0]
        created.append(('user.delete', [userid]))
        reader = login(temp_user, temp_password)
        for label, source, expected in sources:
            result = menu(reader, source)
            assert result.get('itemid') == source['data']['itemid'], (label, list(result))
            assert not result['isWriteable'] and not result['allowed_ui_conf_hosts'], label
            assert not result['isExecutable'], label
            assert result['showGraph'] == expected['showGraph'], label
        for label, action, params in pages:
            page = get(reader, action, **params)
            assert 'ItemActions.install(' in page, label
            if label == 'Docker':
                tab = json.loads(get(reader, 'docker.tab', hostid=docker['hostid'], tab='node'))
                if 'main_block' in tab:
                    tab = json.loads(tab['main_block'])
                page += tab['html']
            assert Elements(page).menus, label
        print('Read-only user: all four pages work; editing/configuration and Execute now are restricted by native Zabbix permissions.')

        executable = next((entry for entry in sources if entry[2]['isExecutable']), None)
        assert executable, 'Need one item type supporting Execute now for this check.'
        api('role.update', {'roleid': roleid, 'rules': {
            'actions': [{'name': 'invoke_execute_now', 'status': 1}]}})
        reader = login(temp_user, temp_password)
        response = menu(reader, executable[1])
        assert response['isExecutable'] and not response['isWriteable'] and not response['allowed_ui_conf_hosts']
        print('Role permission enabled: Execute now becomes available on a read-only host without enabling configuration.')

        # Removing this temporary group's access must also revoke the native menu for a guessed item ID.
        api('usergroup.update', {'usrgrpid': usrgrpid, 'hostgroup_rights': []})
        response = menu(reader, sources[0][1])
        assert 'error' in response, list(response)
        print('Revoked host access: native endpoint rejects the item. Numeric/text graph eligibility also verified.')
    finally:
        for method, params in reversed(created):
            api(method, params)
        if token:
            api('user.logout', [])
        if created:
            print('Temporary permission-check user, group and role removed.')


if __name__ == '__main__':
    main()
