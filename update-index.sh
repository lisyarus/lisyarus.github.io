#!/usr/bin/env bash

echo -n > index.html

links=""
for file in $(find -name '*.html' | grep -v 'index.html')
do
	trunk=$(echo $file | sed -e 's/\.html//')
	link="<a href='$file'>$trunk</a><br/>"
	links="${links}\n${link}"
done

links=$(echo -e "$links")
template=$(cat index.html.template)
result="${template//LINKS/"$links"}"

echo "$result" > index.html

git add index.html
git commit -m "Update index.html"
