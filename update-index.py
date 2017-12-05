#!/usr/bin/env python3


import os


def main():
	


	template = None
	with open('index.html.template', 'rt') as f:
		template = f.read()

	link_lines = []

	for root, dirs, files in os.walk(os.path.curdir):
		for file in files:
			if file != 'index.html' and file.endswith('.html'):
				link = file
				name = link[0].upper() + link[1:-5].replace('_', ' ')
				image_link = 'screenshots/' + link[:-5] + '.png'
				line = "<tr><td width='30%'><a href='" + link + "'>" + name + "</a></td><td><img width='100%' src='" + image_link + "'></td></tr>"
				link_lines.append(line)

		
	links_html = '<br/>\n'.join(link_lines)
	output_html = template.replace('$LINKS', links_html)
	
	with open('index.html', 'wt') as f:
		f.write(output_html)


if __name__ == '__main__':
	main()
