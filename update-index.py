#!/usr/bin/env python3


import os


def main():

	template = None
	with open('index.html.template', 'rt') as f:
		template = f.read()

	element_template = None
	with open('element.html.template', 'rt') as f:
		element_template = f.read()

	link_lines = []

	for root, dirs, files in os.walk(os.path.curdir):
		for file in files:
			if file != 'index.html' and file.endswith('.html'):
				link = file
				name = link[:-5]
				rname = name[0].upper() + name[1:].replace('_', ' ')
				line = element_template.replace('$NAME', name).replace('$RNAME', rname)
				link_lines.append(line)

		
	links_html = '\n'.join(link_lines)
	output_html = template.replace('$ENTRIES', links_html)
	
	with open('index.html', 'wt') as f:
		f.write(output_html)


if __name__ == '__main__':
	main()
